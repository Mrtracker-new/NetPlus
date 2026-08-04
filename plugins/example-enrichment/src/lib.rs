//! A first-party **enrichment plugin** reference (docs/24 §4.3). It adds host
//! metadata from a **local, offline** table only — an enrichment that phones home
//! violates the capability model and is rejected (docs/24 §4.3, §5). The seam
//! trait exposes no network access to grant, so "local only" is structural, not a
//! promise. This toy resolves a couple of well-known IP ranges to an organization
//! label from a hard-coded local map.
#![forbid(unsafe_code)]

use std::net::IpAddr;

use netpulse_core::model::Host;
use netpulse_core::Result;
use netpulse_plugin::{
    Configurable, ContractVersion, Enrichment, PluginConfigurationMetadata, PluginManifest,
    PluginMetadata, PluginSecurityMetadata, PluginType, Sha256Digest, TrustMetadata, TrustStatus,
};

/// Resolves hosts to an org label from a local, in-memory table (stands in for an
/// offline reputation/ASN database).
#[derive(Debug, Default)]
pub struct LocalOrgEnrichment;

impl Configurable for LocalOrgEnrichment {}

impl LocalOrgEnrichment {
    /// The local lookup: first-octet → org. Purely offline (docs/24 §4.3).
    fn org_for(ip: &IpAddr) -> Option<&'static str> {
        match ip {
            IpAddr::V4(v4) => match v4.octets()[0] {
                198 => Some("Example CDN"),
                203 => Some("Example Cloud"),
                _ => None,
            },
            IpAddr::V6(_) => None,
        }
    }
}

impl Enrichment for LocalOrgEnrichment {
    fn id(&self) -> &'static str {
        "example.local-org"
    }

    fn enrich_host(&self, host: &Host) -> Result<Option<Host>> {
        // Honest absence: if the local table has nothing, return None rather than
        // inventing an org (docs/12 §8).
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

/// The plugin's self-description (docs/24 §6): a first-party enrichment reference.
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

    #[test]
    fn enriches_from_local_table_only() {
        let e = LocalOrgEnrichment;
        let known = e
            .enrich_host(&host(IpAddr::V4(Ipv4Addr::new(198, 51, 100, 5))))
            .unwrap();
        assert_eq!(known.unwrap().org.as_deref(), Some("Example CDN"));
        // Unknown host → honest None, never fabricated (docs/12 §8).
        let unknown = e
            .enrich_host(&host(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))))
            .unwrap();
        assert!(unknown.is_none());
    }

    #[test]
    fn enrichment_capability_is_local_only() {
        // The seam grants only local-data reads — there is no network capability
        // in the model to grant (docs/24 §4.3, §5).
        assert_eq!(
            capabilities_for(PluginType::Enrichment),
            &[Capability::ReadLocalData]
        );
    }
}
