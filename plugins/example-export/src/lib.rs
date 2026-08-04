//! A first-party **export plugin** reference (docs/24 §4.5). It adds an output
//! format under the *same* privacy discipline as built-in exports — it operates on
//! already-scoped, already-sanitized structured input and **writes bytes; it never
//! transmits them** (docs/23 §6, docs/24 §4.5). No implicit egress: the single
//! egress boundary stays `netpulse-ai` (docs/02 §10.1). This toy emits a trivial
//! line-oriented "flat" format to demonstrate the seam.
#![forbid(unsafe_code)]

use netpulse_core::Result;
use netpulse_plugin::{
    Configurable, ContractVersion, ExportPlugin, PluginConfigurationMetadata, PluginManifest,
    PluginMetadata, PluginSecurityMetadata, PluginType, Sha256Digest, TrustMetadata, TrustStatus,
};

/// Emits a minimal newline-delimited representation of the structured export input.
#[derive(Debug, Default)]
pub struct FlatExport;

impl Configurable for FlatExport {}

impl ExportPlugin for FlatExport {
    fn id(&self) -> &'static str {
        "example.flat"
    }

    fn format(&self) -> &'static str {
        "flat"
    }

    fn export(&self, structured_json: &str) -> Result<Vec<u8>> {
        // Deterministic transform of the already-sanitized input (docs/23 §6): the
        // preview the user approved must match this output exactly, so no non-
        // determinism (clock/RNG) is allowed here.
        let mut out = String::from("# NetPulse flat export (example plugin)\n");
        out.push_str(structured_json.trim());
        out.push('\n');
        Ok(out.into_bytes())
    }
}

/// The plugin's self-description (docs/24 §6): a first-party export reference.
pub fn manifest() -> PluginManifest {
    PluginManifest {
        manifest_version: 1,
        metadata: PluginMetadata {
            name: "example-export".into(),
            plugin_type: PluginType::Export,
            target_contract: ContractVersion(4),
        },
        config: PluginConfigurationMetadata {
            config_version: 1,
            default_config: serde_json::json!({}),
            config_schema: None,
        },
        security: PluginSecurityMetadata {
            trust: TrustMetadata {
                source: "in-tree:plugins/example-export".into(),
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

    #[test]
    fn export_is_deterministic() {
        // Two runs over the same input produce identical bytes — required so the
        // approved preview matches the written file (docs/23 §6).
        let e = FlatExport;
        let a = e.export(r#"{"flows":1}"#).unwrap();
        let b = e.export(r#"{"flows":1}"#).unwrap();
        assert_eq!(a, b);
        assert!(String::from_utf8(a).unwrap().contains(r#"{"flows":1}"#));
    }

    #[test]
    fn export_capability_writes_output_only() {
        // The seam grants output-writing only — no egress capability exists to
        // grant (docs/24 §4.5, §5).
        assert_eq!(
            capabilities_for(PluginType::Export),
            &[Capability::WriteOutput]
        );
    }
}
