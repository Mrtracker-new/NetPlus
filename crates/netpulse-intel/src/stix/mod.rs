//! Local offline STIX threat intelligence feed (docs/18 §4.9).

pub mod indicator;
pub mod matcher;
pub mod parser;

pub use indicator::{StixIndicator, ThreatCategory};
pub use matcher::StixThreatFeed;
pub use parser::parse_stix_bundle;

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_core::net::{FiveTuple, L4Proto, L7Proto};
    use netpulse_core::{Flow, FlowMetrics, FlowState, Timestamp};
    use std::collections::HashMap;
    use std::net::{IpAddr, Ipv4Addr};

    #[test]
    fn unknown_stix_object_types_ignored_gracefully() {
        let json = r#"{
            "type": "bundle",
            "id": "bundle--123",
            "objects": [
                {
                    "type": "indicator",
                    "id": "indicator--1",
                    "name": "Malicious IP",
                    "pattern": "[ipv4-addr:value = '198.51.100.4']"
                },
                {
                    "type": "malware",
                    "id": "malware--2",
                    "name": "Ignored Malware Metadata"
                },
                {
                    "type": "campaign",
                    "id": "campaign--3",
                    "name": "Ignored Campaign"
                }
            ]
        }"#;

        let res = parse_stix_bundle(json).expect("Parse succeeds");
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].id, "indicator--1");
        assert_eq!(
            res[0].ip_value,
            Some(IpAddr::V4(Ipv4Addr::new(198, 51, 100, 4)))
        );
    }

    #[test]
    fn malformed_bundle_returns_clear_error() {
        let bad_json = r#"{ "type": "bundle", "objects": [ { "type": "indicator", "id": }"#;
        let res = parse_stix_bundle(bad_json);
        assert!(res.is_err());
    }

    #[test]
    fn deterministic_matching_across_repeated_loads() {
        let json = r#"{
            "type": "bundle",
            "id": "bundle--99",
            "objects": [
                {
                    "type": "indicator",
                    "id": "indicator--99",
                    "name": "Test IP",
                    "pattern": "[ipv4-addr:value = '203.0.113.50']"
                }
            ]
        }"#;

        let indicators = parse_stix_bundle(json).unwrap();
        let mut feed = StixThreatFeed::new();
        feed.load_indicators(indicators);

        let target_ip = IpAddr::V4(Ipv4Addr::new(203, 0, 113, 50));
        let flow = Flow {
            id: 42,
            key: FiveTuple::new(
                IpAddr::V4(Ipv4Addr::new(192, 168, 1, 10)),
                50000,
                target_ip,
                443,
                L4Proto::Tcp,
            ),
            first_ts: Timestamp::new(0, 0),
            last_ts: Timestamp::new(10, 10),
            l4: L4Proto::Tcp,
            l7: L7Proto::Tls,
            stats: FlowMetrics {
                bytes: 500,
                packets: 5,
                rtt_estimate_nanos: None,
                retransmits: 0,
                loss_indicators: 0,
            },
            state: FlowState::Closed,
        };

        let procs = HashMap::new();
        let flows = vec![flow];
        let view = crate::view::TrafficView {
            flows: &flows,
            events: &[],
            process_of: &procs,
        };

        let matches1 = feed.match_traffic(&view);
        let matches2 = feed.match_traffic(&view);

        assert_eq!(matches1.len(), 1);
        assert_eq!(matches1, matches2);
    }
}
