//! A first-party **view plugin** reference (docs/24 §4.4).
//! It implements the *same* [`ViewPlugin`] trait the built-in UI surfaces use
//! (docs/24 §4) — no second-class API — declaring its read channels over the
//! Query/Stream API (`reads()`). As a presentation surface, its capability is
//! strictly bounded to [`Capability::ApiRead`] (docs/02 §10.2). It has no network,
//! file export, or byte parsing capabilities.
#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};

use netpulse_core::Result;
use netpulse_plugin::{
    Configurable, ContractVersion, JsonSchema, PluginConfigurationMetadata, PluginManifest,
    PluginMetadata, PluginSecurityMetadata, PluginType, Sha256Digest, TrustMetadata, TrustStatus,
    ViewPlugin,
};

/// A reference view plugin surfacing traffic metrics over declared Query/Stream channels.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrafficSummaryView {
    /// Desired UI refresh interval in milliseconds (default: 1000, range: 100..=60000).
    pub refresh_interval_ms: u64,
    /// Maximum number of summary items to retain for UI rendering (default: 50, range: 1..=1000).
    pub max_items: usize,
    /// Whether to render ISO-8601 timestamps in UI cards (default: true).
    pub show_timestamps: bool,
}

impl Default for TrafficSummaryView {
    fn default() -> Self {
        Self {
            refresh_interval_ms: 1000,
            max_items: 50,
            show_timestamps: true,
        }
    }
}

impl Configurable for TrafficSummaryView {
    fn configure(&mut self, config: &serde_json::Value) -> Result<()> {
        if let Some(interval) = config.get("refresh_interval_ms").and_then(|v| v.as_u64()) {
            self.refresh_interval_ms = interval;
        }
        if let Some(items) = config.get("max_items").and_then(|v| v.as_u64()) {
            self.max_items = items as usize;
        }
        if let Some(show_ts) = config.get("show_timestamps").and_then(|v| v.as_bool()) {
            self.show_timestamps = show_ts;
        }
        Ok(())
    }
}

impl ViewPlugin for TrafficSummaryView {
    fn id(&self) -> &'static str {
        "example.traffic-summary"
    }

    fn reads(&self) -> &'static [&'static str] {
        &[
            "query.health_check",
            "query.list_plugins",
            "stream.narrative_feed",
        ]
    }
}

/// The plugin's self-description (docs/24 §6): a first-party view reference.
pub fn manifest() -> PluginManifest {
    PluginManifest {
        manifest_version: 1,
        metadata: PluginMetadata {
            name: "example-view".into(),
            plugin_type: PluginType::View,
            target_contract: ContractVersion(4),
        },
        config: PluginConfigurationMetadata {
            config_version: 1,
            default_config: serde_json::json!({
                "refresh_interval_ms": 1000,
                "max_items": 50,
                "show_timestamps": true
            }),
            config_schema: Some(JsonSchema(serde_json::json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                    "refresh_interval_ms": {
                        "type": "integer",
                        "minimum": 100,
                        "maximum": 60000,
                        "default": 1000
                    },
                    "max_items": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 1000,
                        "default": 50
                    },
                    "show_timestamps": {
                        "type": "boolean",
                        "default": true
                    }
                },
                "required": ["refresh_interval_ms", "max_items", "show_timestamps"]
            }))),
        },
        security: PluginSecurityMetadata {
            trust: TrustMetadata {
                source: "in-tree:plugins/example-view".into(),
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
    use netpulse_plugin::{
        capabilities_for, Capability, DisabledReason, PluginRegistry, VerificationOutcome,
        VerificationSuccess,
    };

    #[test]
    fn trait_conformance_and_capability_isolation() {
        let view = TrafficSummaryView::default();
        assert_eq!(view.id(), "example.traffic-summary");
        assert_eq!(
            view.reads(),
            &[
                "query.health_check",
                "query.list_plugins",
                "stream.narrative_feed"
            ]
        );

        // Capability mapping check
        let caps = capabilities_for(PluginType::View);
        assert_eq!(caps, &[Capability::ApiRead]);

        // Capability isolation negative assertions: ViewPlugin MUST NOT hold write/egress/parse caps
        assert!(!caps.contains(&Capability::ParseBytes));
        assert!(!caps.contains(&Capability::ReadModel));
        assert!(!caps.contains(&Capability::EmitFindings));
        assert!(!caps.contains(&Capability::ReadLocalData));
        assert!(!caps.contains(&Capability::WriteOutput));
    }

    #[test]
    fn manifest_serialization_round_trip() {
        let m = manifest();
        let serialized = serde_json::to_string(&m).expect("manifest should serialize");
        let deserialized: PluginManifest =
            serde_json::from_str(&serialized).expect("manifest should deserialize");
        assert_eq!(m, deserialized);
    }

    #[test]
    fn registry_registration_immutability() {
        let mut reg = PluginRegistry::new(4);
        let m = manifest();
        reg.register(VerificationOutcome {
            manifest: m.clone(),
            claimed_trust: TrustStatus::FirstParty,
            effective_trust: TrustStatus::FirstParty,
            verification_result: Ok(VerificationSuccess::FirstParty("in-tree-key".into())),
            payload_hash_valid: true,
        });

        let registered = &reg.plugins()[0];
        assert_eq!(registered.manifest.metadata.name, "example-view");
        assert_eq!(registered.manifest.metadata.plugin_type, PluginType::View);
        assert_eq!(
            registered.manifest.metadata.target_contract,
            ContractVersion(4)
        );
        assert_eq!(registered.manifest.capabilities(), &[Capability::ApiRead]);
    }

    #[test]
    fn production_schema_validation_success_and_patch_merge() {
        let mut reg = PluginRegistry::new(4);
        let m = manifest();
        reg.register(VerificationOutcome {
            manifest: m,
            claimed_trust: TrustStatus::FirstParty,
            effective_trust: TrustStatus::FirstParty,
            verification_result: Ok(VerificationSuccess::FirstParty("in-tree-key".into())),
            payload_hash_valid: true,
        });

        // RFC 7396 partial merge patch: update max_items only
        let patch_result = reg.patch_plugin(
            "example-view",
            None,
            serde_json::json!({ "max_items": 100 }),
        );
        assert!(patch_result.is_ok(), "partial patch should succeed");

        let updated_cfg = patch_result.unwrap();
        assert_eq!(updated_cfg.get("max_items").unwrap(), &100);
        assert_eq!(updated_cfg.get("refresh_interval_ms").unwrap(), &1000);
        assert_eq!(updated_cfg.get("show_timestamps").unwrap(), &true);
    }

    #[test]
    fn production_schema_validation_edge_case_failures() {
        let mut reg = PluginRegistry::new(4);
        let m = manifest();
        reg.register(VerificationOutcome {
            manifest: m,
            claimed_trust: TrustStatus::FirstParty,
            effective_trust: TrustStatus::FirstParty,
            verification_result: Ok(VerificationSuccess::FirstParty("in-tree-key".into())),
            payload_hash_valid: true,
        });

        // 1. Missing required field
        let res = reg.configure_plugin(
            "example-view",
            serde_json::json!({ "max_items": 50, "show_timestamps": true }),
        );
        assert!(
            res.is_err(),
            "missing required field should fail validation"
        );

        // 2. Invalid type (string for integer)
        let res = reg.configure_plugin(
            "example-view",
            serde_json::json!({ "refresh_interval_ms": "fast", "max_items": 50, "show_timestamps": true }),
        );
        assert!(res.is_err(), "string for integer should fail validation");

        // 3. Out of range minimum (< 100)
        let res = reg.configure_plugin(
            "example-view",
            serde_json::json!({ "refresh_interval_ms": 10, "max_items": 50, "show_timestamps": true }),
        );
        assert!(res.is_err(), "value below minimum should fail validation");

        // 4. Out of range maximum (> 1000)
        let res = reg.configure_plugin(
            "example-view",
            serde_json::json!({ "refresh_interval_ms": 1000, "max_items": 5000, "show_timestamps": true }),
        );
        assert!(res.is_err(), "value above maximum should fail validation");

        // 5. Negative number
        let res = reg.configure_plugin(
            "example-view",
            serde_json::json!({ "refresh_interval_ms": -500, "max_items": 50, "show_timestamps": true }),
        );
        assert!(res.is_err(), "negative number should fail validation");

        // 6. Floating point number for integer
        let res = reg.configure_plugin(
            "example-view",
            serde_json::json!({ "refresh_interval_ms": 1000.5, "max_items": 50, "show_timestamps": true }),
        );
        assert!(res.is_err(), "float for integer should fail validation");

        // 7. Null value for boolean
        let res = reg.configure_plugin(
            "example-view",
            serde_json::json!({ "refresh_interval_ms": 1000, "max_items": 50, "show_timestamps": serde_json::Value::Null }),
        );
        assert!(res.is_err(), "null for boolean should fail validation");
    }

    #[test]
    fn host_trust_and_activation_policy() {
        let mut reg = PluginRegistry::new(4);
        let m = manifest();

        // FirstParty verified plugin auto-enables
        reg.register(VerificationOutcome {
            manifest: m.clone(),
            claimed_trust: TrustStatus::FirstParty,
            effective_trust: TrustStatus::FirstParty,
            verification_result: Ok(VerificationSuccess::FirstParty("key".into())),
            payload_hash_valid: true,
        });

        assert!(reg.plugins()[0].enabled);
        assert_eq!(reg.plugins()[0].disabled_reason, None);

        // Unreviewed plugin defaults to disabled with NotEnabled reason
        let mut unreviewed_manifest = m;
        unreviewed_manifest.metadata.name = "community-view".into();
        reg.register(VerificationOutcome {
            manifest: unreviewed_manifest,
            claimed_trust: TrustStatus::Unreviewed,
            effective_trust: TrustStatus::Unreviewed,
            verification_result: Ok(VerificationSuccess::Unreviewed),
            payload_hash_valid: true,
        });

        let p2 = &reg.plugins()[1];
        assert!(!p2.enabled);
        assert_eq!(p2.disabled_reason, Some(DisabledReason::NotEnabled));
    }
}
