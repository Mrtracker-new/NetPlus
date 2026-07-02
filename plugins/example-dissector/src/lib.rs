//! A first-party **dissector plugin** reference (docs/24 §4.1, the flagship seam).
//! It implements the *same* [`Dissector`] trait the built-ins use (docs/24 §4) —
//! no second-class API — parsing a toy line-oriented "PING/PONG" protocol into
//! [`ProtoEvent`]s. It exists to show contributors the shape of a dissector and to
//! serve as a living conformance reference (docs/24 §10): strict bounds, no panic
//! on hostile bytes (docs/07 §8), and an accompanying manifest declaring the
//! mandatory fuzz target + explanation content (docs/24 §4.1).
#![forbid(unsafe_code)]

use netpulse_core::model::{ProtoEvent, ProtoEventKind};
use netpulse_core::time::Timestamp;
use netpulse_core::Result;
use netpulse_plugin::{
    ContractVersion, Dissector, PluginManifest, PluginType, TrustMetadata, TrustStatus,
};

/// The reference dissector for the toy `PING`/`PONG` line protocol.
#[derive(Debug, Default)]
pub struct PingDissector;

impl Dissector for PingDissector {
    fn protocol(&self) -> &'static str {
        "example.ping"
    }

    fn dissect(&self, flow_id: u64, bytes: &[u8]) -> Result<Vec<ProtoEvent>> {
        // Hostile-input safe: never index without a bounds check; unknown lines
        // are simply ignored, never panic (docs/07 §8). A dissector that parses
        // hostile bytes without care is a liability (docs/24 §4.1).
        let mut events = Vec::new();
        for line in bytes.split(|b| *b == b'\n') {
            let kind = match line {
                b"PING" => ProtoEventKind::Other("example.ping.request".into()),
                b"PONG" => ProtoEventKind::Other("example.ping.response".into()),
                _ => continue,
            };
            events.push(ProtoEvent {
                flow_id,
                ts: Timestamp::new(0, 0),
                kind,
            });
        }
        Ok(events)
    }
}

/// The plugin's self-description (docs/24 §6). As a dissector it declares its
/// mandatory fuzz target and explanation content (docs/24 §4.1); as a first-party
/// example it is trusted and auto-enabled by the registry.
pub fn manifest() -> PluginManifest {
    PluginManifest {
        name: "example-dissector".into(),
        plugin_type: PluginType::Dissector,
        target_contract: ContractVersion(netpulse_api_version()),
        trust: TrustMetadata {
            source: "in-tree:plugins/example-dissector".into(),
            signature: None,
            status: TrustStatus::FirstParty,
        },
        fuzzed: true,
        has_explanation: true,
    }
}

/// The contract version this example targets. Kept as a small constant so the
/// example crate needs no dependency on `netpulse-api` (docs/24 §6 keeps plugins
/// pinned to a declared contract version).
fn netpulse_api_version() -> u32 {
    4
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_plugin::{ContractVersion, PluginRegistry};

    #[test]
    fn parses_known_lines_and_ignores_junk() {
        let d = PingDissector;
        let events = d.dissect(7, b"PING\nGARBAGE\nPONG").unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].flow_id, 7);
    }

    #[test]
    fn never_panics_on_hostile_bytes() {
        // Empty, non-UTF8, and unterminated input must all be handled cleanly.
        let d = PingDissector;
        assert!(d.dissect(1, b"").unwrap().is_empty());
        assert!(d.dissect(1, &[0xff, 0xfe, 0x00, 0x0a]).unwrap().is_empty());
    }

    #[test]
    fn manifest_is_a_complete_first_party_dissector() {
        // Conformance (docs/24 §10): a first-party dissector auto-enables and meets
        // its fuzz + explanation obligations (docs/24 §4.1).
        let mut reg = PluginRegistry::new(4);
        reg.register(manifest());
        let p = &reg.plugins()[0];
        assert!(p.enabled);
        assert!(p.manifest.dissector_obligations_met());
        assert!(p.manifest.is_compatible(ContractVersion(4)));
    }
}
