//! Cryptographic verification engine for NetPulse plugins (docs/24).
//!
//! Trust status (`FirstParty`, `Reviewed`, `Unreviewed`) is **derived from verified
//! Ed25519 signatures and payload hashes**, never self-declared by manifest text.

use ed25519_compact::{KeyPair, PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;

use crate::{PluginManifest, PluginType, TrustStatus};

/// Canonical serialization version (V1).
pub const CANONICAL_VERSION: u32 = 1;

/// SHA-256 payload digest wrapper.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Sha256Digest(pub [u8; 32]);

impl Sha256Digest {
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub fn compute(data: &[u8]) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(data);
        let result = hasher.finalize();
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&result);
        Self(arr)
    }

    pub fn from_hex(hex_str: &str) -> std::result::Result<Self, String> {
        let s = hex_str.trim();
        if s.len() != 64 {
            return Err(format!(
                "Invalid SHA-256 hex length: expected 64, got {}",
                s.len()
            ));
        }
        let mut bytes = [0u8; 32];
        for i in 0..32 {
            bytes[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16)
                .map_err(|e| format!("Invalid hex byte at index {i}: {e}"))?;
        }
        Ok(Self(bytes))
    }

    pub fn to_hex(&self) -> String {
        let mut s = String::with_capacity(64);
        for b in &self.0 {
            s.push_str(&format!("{b:02x}"));
        }
        s
    }
}

impl fmt::Display for Sha256Digest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_hex())
    }
}

/// Ed25519 signature bytes wrapper.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SignatureBytes(pub [u8; 64]);

impl Serialize for SignatureBytes {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_hex())
    }
}

impl<'de> Deserialize<'de> for SignatureBytes {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Self::from_hex(&s).map_err(serde::de::Error::custom)
    }
}

impl SignatureBytes {
    pub fn from_bytes(bytes: [u8; 64]) -> Self {
        Self(bytes)
    }

    pub fn from_hex(hex_str: &str) -> std::result::Result<Self, String> {
        let s = hex_str.trim();
        if s.len() != 128 {
            return Err(format!(
                "Invalid Ed25519 signature hex length: expected 128, got {}",
                s.len()
            ));
        }
        let mut bytes = [0u8; 64];
        for i in 0..64 {
            bytes[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16)
                .map_err(|e| format!("Invalid hex byte at index {i}: {e}"))?;
        }
        Ok(Self(bytes))
    }

    pub fn to_hex(&self) -> String {
        let mut s = String::with_capacity(128);
        for b in &self.0 {
            s.push_str(&format!("{b:02x}"));
        }
        s
    }
}

impl fmt::Display for SignatureBytes {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_hex())
    }
}

/// Supported signature algorithms.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum SignatureAlgorithm {
    Ed25519,
}

/// Reviewer metadata attached to signed plugins.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewerInfo {
    pub reviewer_id: String,
    pub name: String,
    pub signature_date: u64,
}

/// Cryptographic signature entry on a manifest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginSignature {
    pub algorithm: SignatureAlgorithm,
    pub key_id: String,
    pub signature: SignatureBytes,
    pub reviewer_info: Option<ReviewerInfo>,
}

/// Role assigned to a public key in the Keyring.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyRole {
    FirstParty,
    Reviewer,
}

/// Metadata stored in the Keyring per trusted public key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyMetadata {
    pub key_id: String,
    pub public_key: [u8; 32],
    pub role: KeyRole,
    pub created: u64,
    pub expires: Option<u64>,
    pub revoked: bool,
}

/// Keyring holding trusted public keys for verification.
#[derive(Debug, Clone, Default)]
pub struct Keyring {
    keys: Vec<KeyMetadata>,
}

impl Keyring {
    pub fn new() -> Self {
        Self { keys: Vec::new() }
    }

    /// Computes deterministic key ID fingerprint: hex(SHA256(pubkey)[0..16]).
    pub fn fingerprint_key(public_key: &[u8; 32]) -> String {
        let digest = Sha256Digest::compute(public_key);
        let mut s = String::with_capacity(32);
        for b in &digest.0[0..16] {
            s.push_str(&format!("{b:02x}"));
        }
        s
    }

    /// Register a public key in the keyring.
    pub fn add_key(
        &mut self,
        public_key: [u8; 32],
        role: KeyRole,
        created: u64,
        expires: Option<u64>,
    ) -> String {
        let key_id = Self::fingerprint_key(&public_key);
        self.keys.push(KeyMetadata {
            key_id: key_id.clone(),
            public_key,
            role,
            created,
            expires,
            revoked: false,
        });
        key_id
    }

    /// Revoke a key by key_id.
    pub fn revoke_key(&mut self, key_id: &str) -> bool {
        if let Some(k) = self.keys.iter_mut().find(|k| k.key_id == key_id) {
            k.revoked = true;
            return true;
        }
        false
    }

    /// Find metadata for a key by key_id.
    pub fn get_key(&self, key_id: &str) -> Option<&KeyMetadata> {
        self.keys.iter().find(|k| k.key_id == key_id)
    }
}

/// Detailed error taxonomy for verification failures.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum VerificationError {
    SignatureMissing,
    InvalidSignature,
    UnknownKey,
    KeyRevoked,
    KeyExpired,
    PayloadHashMismatch,
    ManifestTampered,
    UnsupportedAlgorithm,
}

impl fmt::Display for VerificationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SignatureMissing => write!(f, "missing required cryptographic signature"),
            Self::InvalidSignature => write!(f, "cryptographic signature verification failed"),
            Self::UnknownKey => write!(f, "signing key ID is not recognized in keyring"),
            Self::KeyRevoked => write!(f, "signing key has been revoked"),
            Self::KeyExpired => write!(f, "signing key has expired"),
            Self::PayloadHashMismatch => write!(f, "plugin binary hash does not match manifest"),
            Self::ManifestTampered => {
                write!(f, "manifest byte representation has been tampered with")
            }
            Self::UnsupportedAlgorithm => write!(f, "unsupported signature algorithm"),
        }
    }
}

/// Successful verification classification.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum VerificationSuccess {
    FirstParty(String),
    Reviewed(String),
    Unreviewed,
}

/// Canonical V1 byte serialization of immutable manifest fields.
///
/// Rules: UTF-8 encoding, big-endian u32 numbers, fixed field sequence:
/// 1. `canonical_version` (u32 BE = 1)
/// 2. `manifest_version` (u32 BE = 1)
/// 3. `name` bytes
/// 4. `plugin_type` byte
/// 5. `target_contract` (u32 BE)
/// 6. `fuzzed` byte (1 or 0)
/// 7. `has_explanation` byte (1 or 0)
/// 8. `payload_hash` 32 raw bytes
pub fn canonical_manifest_bytes(manifest: &PluginManifest) -> Vec<u8> {
    let mut buf = Vec::with_capacity(128);
    buf.extend_from_slice(&CANONICAL_VERSION.to_be_bytes());
    buf.extend_from_slice(&manifest.manifest_version.to_be_bytes());

    let name_bytes = manifest.metadata.name.as_bytes();
    buf.extend_from_slice(&(name_bytes.len() as u32).to_be_bytes());
    buf.extend_from_slice(name_bytes);

    let type_byte = match manifest.metadata.plugin_type {
        PluginType::Dissector => 1u8,
        PluginType::Enrichment => 2u8,
        PluginType::Detector => 3u8,
        PluginType::View => 4u8,
        PluginType::Export => 5u8,
    };
    buf.push(type_byte);
    buf.extend_from_slice(&manifest.metadata.target_contract.0.to_be_bytes());
    buf.push(if manifest.security.fuzzed { 1 } else { 0 });
    buf.push(if manifest.security.has_explanation {
        1
    } else {
        0
    });
    buf.extend_from_slice(&manifest.security.payload_hash.0);
    buf
}

/// Helper function to create an Ed25519 signature over a manifest's canonical bytes.
pub fn sign_manifest(manifest: &PluginManifest, key_pair: &KeyPair) -> SignatureBytes {
    let canonical = canonical_manifest_bytes(manifest);
    let sig = key_pair.sk.sign(&canonical, None);
    SignatureBytes(*sig)
}

/// The result of verifying a manifest and its payload bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VerificationOutcome {
    pub manifest: PluginManifest,
    pub claimed_trust: TrustStatus,
    pub effective_trust: TrustStatus,
    pub verification_result: std::result::Result<VerificationSuccess, VerificationError>,
    pub payload_hash_valid: bool,
}

/// Cryptographic verifier against a trusted Keyring.
#[derive(Debug, Clone)]
pub struct PluginVerifier {
    keyring: Keyring,
}

impl PluginVerifier {
    pub fn new(keyring: Keyring) -> Self {
        Self { keyring }
    }

    /// Verifies manifest and payload bytes against keyring public keys.
    ///
    /// Evaluates signatures and payload hash to derive `effective_trust`.
    pub fn verify(
        &self,
        manifest: PluginManifest,
        payload_bytes: &[u8],
        current_timestamp: u64,
    ) -> VerificationOutcome {
        let claimed = manifest.security.trust.status;

        // 1. Verify payload hash
        let computed_digest = Sha256Digest::compute(payload_bytes);
        let payload_valid = computed_digest == manifest.security.payload_hash;
        if !payload_valid {
            return VerificationOutcome {
                manifest,
                claimed_trust: claimed,
                effective_trust: TrustStatus::Unreviewed,
                verification_result: Err(VerificationError::PayloadHashMismatch),
                payload_hash_valid: false,
            };
        }

        if manifest.security.signatures.is_empty() {
            return VerificationOutcome {
                manifest,
                claimed_trust: claimed,
                effective_trust: TrustStatus::Unreviewed,
                verification_result: Err(VerificationError::SignatureMissing),
                payload_hash_valid: true,
            };
        }

        let canonical_bytes = canonical_manifest_bytes(&manifest);
        let mut highest_trust = TrustStatus::Unreviewed;
        let mut last_error = None;
        let mut success = None;

        // 2. Evaluate multi-signatures in order, tracking highest derived trust
        for sig in &manifest.security.signatures {
            if sig.algorithm != SignatureAlgorithm::Ed25519 {
                last_error = Some(VerificationError::UnsupportedAlgorithm);
                continue;
            }

            let key_meta = match self.keyring.get_key(&sig.key_id) {
                Some(k) => k,
                None => {
                    last_error = Some(VerificationError::UnknownKey);
                    continue;
                }
            };

            if key_meta.revoked {
                last_error = Some(VerificationError::KeyRevoked);
                continue;
            }

            if let Some(exp) = key_meta.expires {
                if current_timestamp > exp {
                    last_error = Some(VerificationError::KeyExpired);
                    continue;
                }
            }

            let pk = match PublicKey::from_slice(&key_meta.public_key) {
                Ok(p) => p,
                Err(_) => {
                    last_error = Some(VerificationError::InvalidSignature);
                    continue;
                }
            };

            let ed_sig = Signature::from_slice(&sig.signature.0);
            let sig_obj = match ed_sig {
                Ok(s) => s,
                Err(_) => {
                    last_error = Some(VerificationError::InvalidSignature);
                    continue;
                }
            };

            if pk.verify(&canonical_bytes, &sig_obj).is_ok() {
                match key_meta.role {
                    KeyRole::FirstParty => {
                        highest_trust = TrustStatus::FirstParty;
                        success = Some(VerificationSuccess::FirstParty(sig.key_id.clone()));
                        break; // FirstParty is maximum achievable trust
                    }
                    KeyRole::Reviewer => {
                        if highest_trust != TrustStatus::FirstParty {
                            highest_trust = TrustStatus::Reviewed;
                            success = Some(VerificationSuccess::Reviewed(sig.key_id.clone()));
                        }
                    }
                }
            } else {
                last_error = Some(VerificationError::InvalidSignature);
            }
        }

        let result = match success {
            Some(s) => Ok(s),
            None => Err(last_error.unwrap_or(VerificationError::InvalidSignature)),
        };

        VerificationOutcome {
            manifest,
            claimed_trust: claimed,
            effective_trust: highest_trust,
            verification_result: result,
            payload_hash_valid: true,
        }
    }
}
