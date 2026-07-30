//! # netpulse-plugin — the extension seams (docs/24)
//!
//! NetPulse grows through contribution: new protocols, detectors, enrichments,
//! views, and export formats. This crate turns the architecture's layer
//! boundaries (docs/02 §15) into **five stable seams** and — crucially — the
//! **capability and trust model** that keeps an extension from compromising the
//! safety, privacy, and honesty guarantees the whole product rests on (docs/24
//! §1). Per docs/24 §7, the loader mechanism (dynamic/WASM) is an implementation
//! detail; the *contracts and capability model here are the specified, stable
//! part*.
//!
//! Three invariants are enforced **structurally**, not by trusting plugin authors
//! (docs/24 §5, §11):
//! - **No plugin gets egress.** There is no network/egress/system [`Capability`]
//!   variant at all — the single egress boundary stays `netpulse-ai` (docs/02
//!   §10.1). A plugin literally cannot request the capability to phone home.
//! - **Least capability per type.** Each [`PluginType`] is granted only the
//!   capabilities its seam needs ([`capabilities_for`]).
//! - **Honesty is preserved.** Detector plugins emit through the core
//!   [`netpulse_core::Finding`] model, which requires evidence — a plugin cannot
//!   emit a bare verdict (docs/24 §5, docs/17 §4).
//!
//! Plugins reuse the *same* traits the built-ins use ([`netpulse_core::Dissector`],
//! [`netpulse_core::Detector`]) — no second-class extension API (docs/24 §4).
#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};

use netpulse_core::model::{Host, Process};
use netpulse_core::Result;

// Re-export the seam traits plugins implement, so a contributor learns one
// contract that serves both built-in and plugin work (docs/24 §4).
pub use netpulse_core::traits::{Detector, Dissector};

/// The five plugin seams, one per layer boundary (docs/24 §3). Each hooks only at
/// its layer's contract and cannot reach around the architecture (docs/02 §4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum PluginType {
    /// Decode layer (docs/07): new protocol parsing + explanations.
    Dissector,
    /// Host/Process metadata (docs/07 §6.2, docs/12): new *local* enrichment.
    Enrichment,
    /// Intelligence (docs/17): new security/anomaly signals as `Finding`s.
    Detector,
    /// Presentation (docs/02 §7): new UI surfaces over the Query/Stream API.
    View,
    /// Export (docs/23): new output formats under the privacy discipline.
    Export,
}

/// A capability a plugin may hold. The set is deliberately small and **contains no
/// network, egress, filesystem, or system-control variant** — those capabilities
/// simply do not exist here, so no plugin can acquire them (docs/24 §5). This is
/// how the privacy guarantee stays auditable even with third-party code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum Capability {
    /// Parse raw bytes (dissectors) — sandboxed, fuzzed, bounded (docs/07 §8).
    ParseBytes,
    /// Read the reconstruction model (detectors) — read-only (docs/17).
    ReadModel,
    /// Emit findings through the `Finding` model (detectors) (docs/17 §4).
    EmitFindings,
    /// Read *local* data only (enrichments) — never the network (docs/24 §4.3).
    ReadLocalData,
    /// Read via the Query/Stream API + fixed command set (views) (docs/02 §10.2).
    ApiRead,
    /// Produce export output under the privacy discipline (exports) (docs/23 §6).
    WriteOutput,
}

/// The exact capabilities granted to each seam (docs/24 §5 "least capability per
/// type"). A dissector can parse bytes but touches nothing else; a detector reads
/// the model and emits findings but cannot egress or act on the system; an
/// enrichment reads only local data.
pub fn capabilities_for(ty: PluginType) -> &'static [Capability] {
    match ty {
        PluginType::Dissector => &[Capability::ParseBytes],
        PluginType::Detector => &[Capability::ReadModel, Capability::EmitFindings],
        PluginType::Enrichment => &[Capability::ReadLocalData],
        PluginType::View => &[Capability::ApiRead],
        PluginType::Export => &[Capability::WriteOutput],
    }
}

/// Review status carried with a plugin (docs/24 §5, §6). Enabling one is an
/// explicit user choice with clear disclosure of its type and capabilities.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum TrustStatus {
    /// Side-loaded without review — shown with a clear "unreviewed" warning
    /// (docs/24 §6).
    Unreviewed,
    /// Passed editorial + technical review for official distribution (docs/24 §6).
    Reviewed,
    /// Shipped in-tree as a first-party reference example (docs/24 §6).
    FirstParty,
}

pub mod verifier;

pub use verifier::{
    canonical_manifest_bytes, sign_manifest, KeyMetadata, KeyRole, Keyring, PluginSignature,
    PluginVerifier, ReviewerInfo, Sha256Digest, SignatureAlgorithm, SignatureBytes,
    VerificationError, VerificationOutcome, VerificationSuccess, CANONICAL_VERSION,
};

/// Provenance/trust metadata (docs/24 §5): where a plugin came from and its review
/// state, so enabling it is an informed, explicit act.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrustMetadata {
    pub source: String,
    pub signatures: Vec<PluginSignature>,
    pub status: TrustStatus,
}

/// The message-contract version a plugin targets (docs/24 §6). The host checks
/// compatibility so plugins don't silently break across upgrades (docs/02 §7.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContractVersion(pub u32);

/// A plugin's self-description (docs/24 §6). Dissector/detector obligations
/// (fuzzing, explanation content) are declared here and checked at registration —
/// a dissector without a fuzz target or explanation content is *incomplete*
/// (docs/24 §4.1, docs/07 §8, §7).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginManifest {
    pub manifest_version: u32,
    pub name: String,
    pub plugin_type: PluginType,
    pub target_contract: ContractVersion,
    pub trust: TrustMetadata,
    pub payload_hash: Sha256Digest,
    pub signatures: Vec<PluginSignature>,
    /// Ships a fuzz target — mandatory for dissectors (docs/24 §4.1, §10).
    pub fuzzed: bool,
    /// Ships explanation content/keys — mandatory for dissectors (docs/24 §4.1).
    pub has_explanation: bool,
}

impl PluginManifest {
    /// The capabilities this plugin is granted by its type (docs/24 §5).
    pub fn capabilities(&self) -> &'static [Capability] {
        capabilities_for(self.plugin_type)
    }

    /// Whether the plugin targets a contract the host can serve (docs/24 §6). The
    /// host refuses newer-than-itself contracts rather than misbehaving silently.
    pub fn is_compatible(&self, host: ContractVersion) -> bool {
        self.target_contract.0 == host.0
    }

    /// Whether a dissector plugin meets its mandatory obligations (docs/24 §4.1):
    /// a fuzz target and explanation content. Non-dissectors are unaffected.
    pub fn dissector_obligations_met(&self) -> bool {
        self.plugin_type != PluginType::Dissector || (self.fuzzed && self.has_explanation)
    }
}

/// An enrichment plugin: adds host/process metadata from **local, offline** data
/// only (docs/24 §4.3). An enrichment that reaches the network violates the
/// capability model and is rejected — the trait exposes no network access to grant.
pub trait Enrichment {
    /// Stable enrichment identifier, surfaced for auditability.
    fn id(&self) -> &'static str;
    /// Enrich a host from local databases (geo/ASN/org), returning the augmented
    /// host or `None` if nothing local matched (honest absence, docs/12 §8).
    fn enrich_host(&self, host: &Host) -> Result<Option<Host>>;
    /// Optionally enrich process identity from local data (docs/12 §6).
    fn enrich_process(&self, _process: &Process) -> Result<Option<Process>> {
        Ok(None)
    }
}

/// A view/panel plugin: consumes the Query/Stream API — the *same* contract the
/// built-in UI uses (docs/24 §4.4) — and nothing more (UI sandbox, docs/02 §10.2).
/// Marker trait: the actual surface runs in the webview; the capability boundary
/// is what matters here.
pub trait ViewPlugin {
    fn id(&self) -> &'static str;
    /// The channels/queries this view reads — declared, so its access is auditable
    /// and bounded to `ApiRead` (docs/02 §10.2).
    fn reads(&self) -> &'static [&'static str];
}

/// An export plugin: adds an output format (docs/24 §4.5) under the same privacy
/// discipline as built-ins — preview, sanitization, no implicit egress (docs/23
/// §6). It writes bytes; it never transmits them.
pub trait ExportPlugin {
    fn id(&self) -> &'static str;
    /// The format's short name (e.g. "har", "siem").
    fn format(&self) -> &'static str;
    /// Serialize the already-scoped, already-sanitized structured input to bytes.
    fn export(&self, structured_json: &str) -> Result<Vec<u8>>;
}

/// Why a plugin is not currently active (docs/24 §8), surfaced to the user rather
/// than failing silently.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum DisabledReason {
    /// Targets a contract version the host can't serve (docs/24 §8).
    IncompatibleContract,
    /// A dissector missing its fuzz target and/or explanation content (docs/24 §4.1).
    IncompleteDissector,
    /// Cryptographic signature verification failed or signature is invalid.
    InvalidSignature,
    /// Missing required signature for claimed FirstParty or Reviewed status.
    SignatureMissing,
    /// Plugin binary payload hash does not match manifest payload_hash.
    PayloadHashMismatch,
    /// Signing key has been revoked.
    KeyRevoked,
    /// Signing key has expired.
    KeyExpired,
    /// Manifest byte representation has been tampered with.
    ManifestTampered,
    /// The user has not enabled it (default for unreviewed side-loads, docs/24 §5).
    NotEnabled,
}

/// A registered plugin and its current activation state (docs/24 §6).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RegisteredPlugin {
    pub manifest: PluginManifest,
    pub enabled: bool,
    /// Present when the plugin is not active, explaining why (docs/24 §8).
    pub disabled_reason: Option<DisabledReason>,
    /// Cryptographically derived effective trust status.
    pub effective_trust: TrustStatus,
}

/// The host-side registry (docs/24 §6). The core does not distinguish built-in
/// from plugin at runtime except for trust metadata (docs/24 §4); this registry is
/// where compatibility and capability checks live, so a broken or hostile plugin
/// is contained (docs/24 §5, §8).
#[derive(Debug, Clone, Default)]
pub struct PluginRegistry {
    host_contract: u32,
    plugins: Vec<RegisteredPlugin>,
}

impl PluginRegistry {
    /// A registry serving `host_contract` (the current `API_VERSION`).
    pub fn new(host_contract: u32) -> Self {
        Self {
            host_contract,
            plugins: Vec::new(),
        }
    }

    /// Register a verified plugin outcome, computing its activation eligibility (docs/24 §6, §8).
    ///
    /// Accepts ONLY a [`VerificationOutcome`] produced by [`PluginVerifier::verify`].
    /// First-party plugins with valid signature auto-enable; unreviewed or invalid plugins
    /// default to disabled until explicit user consent or signature fix.
    pub fn register(&mut self, outcome: VerificationOutcome) {
        let mut manifest = outcome.manifest;
        manifest.trust.status = outcome.effective_trust;

        let reason = if !manifest.is_compatible(ContractVersion(self.host_contract)) {
            Some(DisabledReason::IncompatibleContract)
        } else if !manifest.dissector_obligations_met() {
            Some(DisabledReason::IncompleteDissector)
        } else if let Err(ref err) = outcome.verification_result {
            match err {
                VerificationError::PayloadHashMismatch => Some(DisabledReason::PayloadHashMismatch),
                VerificationError::KeyRevoked => Some(DisabledReason::KeyRevoked),
                VerificationError::KeyExpired => Some(DisabledReason::KeyExpired),
                VerificationError::SignatureMissing => {
                    if outcome.claimed_trust == TrustStatus::FirstParty
                        || outcome.claimed_trust == TrustStatus::Reviewed
                    {
                        Some(DisabledReason::SignatureMissing)
                    } else {
                        Some(DisabledReason::NotEnabled)
                    }
                }
                _ => Some(DisabledReason::InvalidSignature),
            }
        } else if outcome.effective_trust != TrustStatus::FirstParty {
            Some(DisabledReason::NotEnabled)
        } else {
            None
        };

        self.plugins.push(RegisteredPlugin {
            enabled: reason.is_none(),
            disabled_reason: reason,
            manifest,
            effective_trust: outcome.effective_trust,
        });
    }

    /// Enable a plugin by name — an explicit user action (docs/24 §5). Refuses to
    /// enable one that is structurally ineligible (incompatible/incomplete),
    /// keeping the reason honest (docs/24 §8). Returns whether it is now enabled.
    pub fn enable(&mut self, name: &str) -> bool {
        if let Some(p) = self.plugins.iter_mut().find(|p| p.manifest.name == name) {
            match p.disabled_reason {
                // Only a user-consent gate can be lifted by enabling; structural
                // ineligibility cannot be overridden (docs/24 §8).
                None | Some(DisabledReason::NotEnabled) => {
                    p.enabled = true;
                    p.disabled_reason = None;
                    return true;
                }
                _ => return false,
            }
        }
        false
    }

    /// Disable a plugin by name (docs/24 §6).
    pub fn disable(&mut self, name: &str) -> bool {
        if let Some(p) = self.plugins.iter_mut().find(|p| p.manifest.name == name) {
            p.enabled = false;
            p.disabled_reason = Some(DisabledReason::NotEnabled);
            return true;
        }
        false
    }

    /// All registered plugins with their state (docs/24 §6).
    pub fn plugins(&self) -> &[RegisteredPlugin] {
        &self.plugins
    }

    /// Currently active plugins only.
    pub fn enabled(&self) -> impl Iterator<Item = &RegisteredPlugin> {
        self.plugins.iter().filter(|p| p.enabled)
    }
}

/// A guarantee-check callable from tests and CI: no capability grants egress or
/// system access (docs/24 §5). Kept as a function so the invariant is exercised,
/// not just documented — and the exhaustive `match` below means adding any future
/// [`Capability`] variant fails to compile here until it is consciously classified
/// as local/safe, which is exactly the canary this provides.
pub fn no_capability_grants_egress() -> bool {
    for ty in [
        PluginType::Dissector,
        PluginType::Detector,
        PluginType::Enrichment,
        PluginType::View,
        PluginType::Export,
    ] {
        for cap in capabilities_for(ty) {
            match cap {
                // Every variant here is local/read/parse/write-output only. There
                // is deliberately no network/egress/system variant to match.
                Capability::ParseBytes
                | Capability::ReadModel
                | Capability::EmitFindings
                | Capability::ReadLocalData
                | Capability::ApiRead
                | Capability::WriteOutput => {}
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_compact::KeyPair;

    fn manifest(
        name: &str,
        ty: PluginType,
        status: TrustStatus,
        payload_bytes: &[u8],
    ) -> PluginManifest {
        PluginManifest {
            manifest_version: 1,
            name: name.into(),
            plugin_type: ty,
            target_contract: ContractVersion(4),
            trust: TrustMetadata {
                source: "in-tree".into(),
                signatures: Vec::new(),
                status,
            },
            payload_hash: Sha256Digest::compute(payload_bytes),
            signatures: Vec::new(),
            fuzzed: true,
            has_explanation: true,
        }
    }

    fn outcome(
        m: PluginManifest,
        effective: TrustStatus,
        res: std::result::Result<VerificationSuccess, VerificationError>,
    ) -> VerificationOutcome {
        VerificationOutcome {
            manifest: m.clone(),
            claimed_trust: m.trust.status,
            effective_trust: effective,
            verification_result: res,
            payload_hash_valid: true,
        }
    }

    #[test]
    fn no_seam_gets_egress() {
        assert!(no_capability_grants_egress());
        assert_eq!(
            capabilities_for(PluginType::Enrichment),
            &[Capability::ReadLocalData]
        );
    }

    #[test]
    fn incompatible_contract_is_disabled_with_reason() {
        let mut reg = PluginRegistry::new(4);
        let mut m = manifest(
            "old-diss",
            PluginType::Dissector,
            TrustStatus::FirstParty,
            b"wasm",
        );
        m.target_contract = ContractVersion(3);
        reg.register(outcome(
            m,
            TrustStatus::FirstParty,
            Ok(VerificationSuccess::FirstParty("key1".into())),
        ));
        let p = &reg.plugins()[0];
        assert!(!p.enabled);
        assert_eq!(
            p.disabled_reason,
            Some(DisabledReason::IncompatibleContract)
        );
        assert!(!reg.clone().enable("old-diss"));
    }

    #[test]
    fn dissector_needs_fuzz_and_explanation() {
        let mut reg = PluginRegistry::new(4);
        let mut m = manifest(
            "bare-diss",
            PluginType::Dissector,
            TrustStatus::FirstParty,
            b"wasm",
        );
        m.fuzzed = false;
        reg.register(outcome(
            m,
            TrustStatus::FirstParty,
            Ok(VerificationSuccess::FirstParty("key1".into())),
        ));
        assert_eq!(
            reg.plugins()[0].disabled_reason,
            Some(DisabledReason::IncompleteDissector)
        );
    }

    #[test]
    fn unreviewed_plugin_defaults_disabled_until_enabled() {
        let mut reg = PluginRegistry::new(4);
        let m = manifest(
            "community",
            PluginType::Detector,
            TrustStatus::Unreviewed,
            b"wasm",
        );
        reg.register(outcome(
            m,
            TrustStatus::Unreviewed,
            Ok(VerificationSuccess::Unreviewed),
        ));
        assert!(!reg.plugins()[0].enabled);
        assert_eq!(reg.enabled().count(), 0);
        assert_eq!(
            reg.plugins()[0].disabled_reason,
            Some(DisabledReason::NotEnabled)
        );
        assert!(reg.enable("community"));
        assert!(reg.plugins()[0].enabled);
    }

    #[test]
    fn first_party_verified_auto_enables() {
        let mut reg = PluginRegistry::new(4);
        let m = manifest(
            "example-detector",
            PluginType::Detector,
            TrustStatus::FirstParty,
            b"wasm",
        );
        reg.register(outcome(
            m,
            TrustStatus::FirstParty,
            Ok(VerificationSuccess::FirstParty("key1".into())),
        ));
        assert!(reg.plugins()[0].enabled);
        assert_eq!(reg.enabled().count(), 1);
    }

    #[test]
    fn forged_first_party_claim_demoted_and_disabled() {
        let payload = b"hostile-plugin-bytes";
        let m = manifest(
            "fake-official",
            PluginType::Detector,
            TrustStatus::FirstParty,
            payload,
        );
        let keyring = Keyring::new();
        let verifier = PluginVerifier::new(keyring);
        let outcome = verifier.verify(m.clone(), payload, 1000);

        assert_eq!(outcome.effective_trust, TrustStatus::Unreviewed);
        assert_eq!(
            outcome.verification_result,
            Err(VerificationError::SignatureMissing)
        );

        let mut reg = PluginRegistry::new(4);
        reg.register(outcome);
        let p = &reg.plugins()[0];
        assert!(!p.enabled);
        assert_eq!(p.effective_trust, TrustStatus::Unreviewed);
        assert_eq!(p.disabled_reason, Some(DisabledReason::SignatureMissing));
    }

    #[test]
    fn valid_ed25519_first_party_signature_derives_first_party_trust() {
        let kp = KeyPair::generate();
        let mut keyring = Keyring::new();
        let key_id = keyring.add_key(*kp.pk, KeyRole::FirstParty, 100, None);

        let payload = b"valid-first-party-wasm";
        let mut m = manifest(
            "official-plugin",
            PluginType::Detector,
            TrustStatus::Unreviewed,
            payload,
        );
        let sig_bytes = sign_manifest(&m, &kp);
        m.signatures.push(PluginSignature {
            algorithm: SignatureAlgorithm::Ed25519,
            key_id,
            signature: sig_bytes,
            reviewer_info: None,
        });

        let verifier = PluginVerifier::new(keyring);
        let outcome = verifier.verify(m, payload, 200);

        assert_eq!(outcome.effective_trust, TrustStatus::FirstParty);
        assert!(outcome.verification_result.is_ok());

        let mut reg = PluginRegistry::new(4);
        reg.register(outcome);
        assert!(reg.plugins()[0].enabled);
    }

    #[test]
    fn payload_hash_mismatch_fails_verification() {
        let kp = KeyPair::generate();
        let mut keyring = Keyring::new();
        let key_id = keyring.add_key(*kp.pk, KeyRole::FirstParty, 100, None);

        let payload = b"original-payload";
        let mut m = manifest(
            "tampered-plugin",
            PluginType::Detector,
            TrustStatus::Unreviewed,
            payload,
        );
        let sig_bytes = sign_manifest(&m, &kp);
        m.signatures.push(PluginSignature {
            algorithm: SignatureAlgorithm::Ed25519,
            key_id,
            signature: sig_bytes,
            reviewer_info: None,
        });

        let verifier = PluginVerifier::new(keyring);
        // Tampered payload passed to verify()
        let outcome = verifier.verify(m, b"tampered-payload", 200);

        assert_eq!(
            outcome.verification_result,
            Err(VerificationError::PayloadHashMismatch)
        );
        assert!(!outcome.payload_hash_valid);

        let mut reg = PluginRegistry::new(4);
        reg.register(outcome);
        assert!(!reg.plugins()[0].enabled);
        assert_eq!(
            reg.plugins()[0].disabled_reason,
            Some(DisabledReason::PayloadHashMismatch)
        );
    }

    #[test]
    fn revoked_key_rejects_verification() {
        let kp = KeyPair::generate();
        let mut keyring = Keyring::new();
        let key_id = keyring.add_key(*kp.pk, KeyRole::FirstParty, 100, None);
        keyring.revoke_key(&key_id);

        let payload = b"payload";
        let mut m = manifest(
            "revoked-plugin",
            PluginType::Detector,
            TrustStatus::Unreviewed,
            payload,
        );
        let sig_bytes = sign_manifest(&m, &kp);
        m.signatures.push(PluginSignature {
            algorithm: SignatureAlgorithm::Ed25519,
            key_id,
            signature: sig_bytes,
            reviewer_info: None,
        });

        let verifier = PluginVerifier::new(keyring);
        let outcome = verifier.verify(m, payload, 200);

        assert_eq!(
            outcome.verification_result,
            Err(VerificationError::KeyRevoked)
        );
    }
}
