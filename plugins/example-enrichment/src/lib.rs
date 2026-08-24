//! A first-party **enrichment plugin** reference. It adds host
//! metadata from a **local, offline** table only — an enrichment that phones home
//! violates the capability model and is rejected. The seam
//! trait exposes no network access to grant, so "local only" is structural, not a
//! promise.
//!
//! # ASN / org resolution contract
//!
//! Resolution MUST be **IP → exact longest-prefix-match → org/ASN**.
//! It MUST NOT be **IP → broad /8 guess → famous company name**.
//!
//! A /8 (or any coarse prefix) is not an authoritative attribution: large
//! allocations like `17.0.0.0/8`, `20.0.0.0/8`, or `52.0.0.0/8` contain
//! millions of addresses that may not belong to the headline registrant.
//! Matching on the first octet alone would display, e.g., "Microsoft AS8075"
//! for `20.123.45.67` — a false positive that is worse than no result.
//!
//! Rule: if no **exact, specific-prefix** match exists in the local DB,
//! return `None`.  `None` ("unresolved") is always correct; a wrong org name
//! is a data quality defect.
//!
//! This example uses the RFC 5737 TEST-NET ranges (`192.0.2.0/24`,
//! `198.51.100.0/24`, `203.0.113.0/24`) as the only entries, because those
//! are the only ranges whose purpose is unambiguously documented and stable.
#![forbid(unsafe_code)]

use std::net::IpAddr;

use netpulse_core::model::Host;
use netpulse_core::Result;
use netpulse_plugin::{
    Configurable, ContractVersion, Enrichment, PluginConfigurationMetadata, PluginManifest,
    PluginMetadata, PluginSecurityMetadata, PluginType, Sha256Digest, TrustMetadata, TrustStatus,
};

/// One entry in the local prefix table: a network address, its prefix length,
/// and the org label that exactly covers that prefix.
struct PrefixEntry {
    /// Network address as a packed u32 (host-byte order).
    network: u32,
    /// Prefix length (0–32).
    prefix_len: u8,
    /// Org / ASN owner label.
    org: &'static str,
}

impl PrefixEntry {
    const fn new(a: u8, b: u8, c: u8, d: u8, prefix_len: u8, org: &'static str) -> Self {
        Self {
            network: u32::from_be_bytes([a, b, c, d]),
            prefix_len,
            org,
        }
    }

    /// True when `addr` falls inside this prefix.
    fn contains(&self, addr: u32) -> bool {
        if self.prefix_len == 0 {
            return true;
        }
        let shift = 32 - self.prefix_len as u32;
        (addr >> shift) == (self.network >> shift)
    }
}

/// The local prefix table.
///
/// **Production rule**: entries must be specific, authoritative prefixes — not
/// coarse /8 allocations.  Broad first-octet matches produce false positives
/// for the millions of addresses that share a /8 with the headline registrant
/// but belong to entirely different operators.
///
/// This reference table contains only the three RFC 5737 TEST-NET ranges
/// (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`), which are the only
/// IPv4 ranges whose purpose and owner are permanently and unambiguously
/// documented.
const PREFIX_TABLE: &[PrefixEntry] = &[
    // RFC 5737 TEST-NET-1 — documentation/example use only.
    PrefixEntry::new(192, 0, 2, 0, 24, "Example CDN (TEST-NET-1)"),
    // RFC 5737 TEST-NET-2 — documentation/example use only.
    PrefixEntry::new(198, 51, 100, 0, 24, "Example Cloud (TEST-NET-2)"),
    // RFC 5737 TEST-NET-3 — documentation/example use only.
    PrefixEntry::new(203, 0, 113, 0, 24, "Example ISP (TEST-NET-3)"),
];

/// Resolves hosts to an org label from a local, in-memory prefix table
/// (stands in for an offline ASN/reputation database).
///
/// Uses **longest-prefix-match**: the most-specific prefix that contains the
/// address wins.  Returns `None` when no entry matches — never a guess.
#[derive(Debug, Default)]
pub struct LocalOrgEnrichment;

impl Configurable for LocalOrgEnrichment {}

impl LocalOrgEnrichment {
    /// Longest-prefix-match over [`PREFIX_TABLE`].
    ///
    /// Returns the `org` label of the most-specific matching prefix, or `None`
    /// if no entry covers `ip`.  `None` is the correct answer for every address
    /// that is not in the local DB — it is never fabricated.
    fn org_for(ip: &IpAddr) -> Option<&'static str> {
        let addr_u32 = match ip {
            IpAddr::V4(v4) => u32::from(*v4),
            // IPv6 is not covered by this example table.
            IpAddr::V6(_) => return None,
        };

        // Longest-prefix-match: among all entries that contain addr_u32, pick
        // the one with the greatest prefix_len (most specific).
        PREFIX_TABLE
            .iter()
            .filter(|e| e.contains(addr_u32))
            .max_by_key(|e| e.prefix_len)
            .map(|e| e.org)
    }
}

impl Enrichment for LocalOrgEnrichment {
    fn id(&self) -> &'static str {
        "example.local-org"
    }

    fn enrich_host(&self, host: &Host) -> Result<Option<Host>> {
        // Honest absence: if the local prefix table has nothing for this IP,
        // return None.  An unresolved result is always correct; a fabricated
        // org name is a data quality defect.
        match Self::org_for(&host.ip) {
            Some(org) => {
                let mut enriched = host.clone();
                enriched.org = Some(org.to_string());
                Ok(Some(enriched))
            }
            None => Ok(None),
        }
    }
}

/// The plugin's self-description: a first-party enrichment reference.
pub fn manifest() -> PluginManifest {
    PluginManifest {
        manifest_version: 1,
        metadata: PluginMetadata {
            name: "example-enrichment".into(),
            plugin_type: PluginType::Enrichment,
            target_contract: ContractVersion(4),
        },
        config: PluginConfigurationMetadata {
            config_version: 1,
            default_config: serde_json::json!({}),
            config_schema: None,
        },
        security: PluginSecurityMetadata {
            trust: TrustMetadata {
                source: "in-tree:plugins/example-enrichment".into(),
                signatures: Vec::new(),
                status: TrustStatus::FirstParty,
            },
            payload_hash: Sha256Digest([0u8; 32]),
            signatures: Vec::new(),
            fuzzed: false,
            has_explanation: false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_plugin::{capabilities_for, Capability, PluginType};
    use std::net::Ipv4Addr;

    fn host(ip: IpAddr) -> Host {
        Host {
            ip,
            names: vec![],
            geo: None,
            asn: None,
            org: None,
        }
    }

    /// Addresses inside a documented /24 prefix resolve to the correct label.
    #[test]
    fn resolves_addresses_inside_known_prefix() {
        let e = LocalOrgEnrichment;

        // TEST-NET-2 (198.51.100.0/24) → "Example Cloud (TEST-NET-2)"
        let known = e
            .enrich_host(&host(IpAddr::V4(Ipv4Addr::new(198, 51, 100, 5))))
            .unwrap();
        assert_eq!(
            known.unwrap().org.as_deref(),
            Some("Example Cloud (TEST-NET-2)")
        );

        // TEST-NET-1 (192.0.2.0/24) → "Example CDN (TEST-NET-1)"
        let known2 = e
            .enrich_host(&host(IpAddr::V4(Ipv4Addr::new(192, 0, 2, 1))))
            .unwrap();
        assert_eq!(
            known2.unwrap().org.as_deref(),
            Some("Example CDN (TEST-NET-1)")
        );
    }

    /// Addresses in the same /8 as a known prefix but outside the exact /24 MUST
    /// return None.  The old first-octet lookup would have falsely attributed
    /// 198.99.0.1 to "Example CDN" because it shares the first octet with
    /// 198.51.100.0/24 — a /8-granularity false positive.
    #[test]
    fn rejects_addresses_outside_exact_prefix_same_first_octet() {
        let e = LocalOrgEnrichment;

        // 198.99.0.1 shares first octet 198 with TEST-NET-2 but is NOT in
        // 198.51.100.0/24 — must be unresolved.
        let out_of_prefix = e
            .enrich_host(&host(IpAddr::V4(Ipv4Addr::new(198, 99, 0, 1))))
            .unwrap();
        assert!(
            out_of_prefix.is_none(),
            "address outside exact prefix must be unresolved, not falsely attributed"
        );

        // 192.168.1.1 shares first octet 192 with TEST-NET-1 but is NOT in
        // 192.0.2.0/24 — must be unresolved.
        let private_ip = e
            .enrich_host(&host(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1))))
            .unwrap();
        assert!(
            private_ip.is_none(),
            "private address outside exact prefix must be unresolved"
        );
    }

    /// Completely unknown addresses → honest None, never fabricated.
    #[test]
    fn unknown_host_returns_none() {
        let e = LocalOrgEnrichment;
        let unknown = e
            .enrich_host(&host(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))))
            .unwrap();
        assert!(unknown.is_none());
    }

    #[test]
    fn enrichment_capability_is_local_only() {
        // The seam grants only local-data reads — there is no network capability
        // in the model to grant.
        assert_eq!(
            capabilities_for(PluginType::Enrichment),
            &[Capability::ReadLocalData]
        );
    }
}
