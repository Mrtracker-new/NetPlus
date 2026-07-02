//! The Phase 2 wire types (docs/02 §7, docs/09–§12). These are the *contract
//! DTOs*: the exact shapes that cross the Tauri IPC boundary between engine and
//! UI. They are deliberately separate from the internal domain types in
//! `netpulse-narrative` / `netpulse-engine` (which sit *above* this crate in the
//! layer graph, docs/04 §3) — the engine maps its rich types down into these
//! stable, serializable projections when it answers a query or pushes a delta.
//!
//! Keeping wire types distinct from domain types means the UI contract can stay
//! stable while internal representations evolve, and it keeps this crate's
//! dependency set tiny (core + serde only) — the contract is security-sensitive
//! surface (docs/03 §7), so it carries no heavy dependencies.
//!
//! Every serde representation here is mirrored, field-for-field, by the
//! TypeScript emitter in [`crate::codegen`]; a test asserts the two agree, and a
//! serde round-trip test per type exercises the field names.

use serde::{Deserialize, Serialize};

/// The disclosure/projection depth carried on a query (docs/09 §6.3). Mirrors
/// `netpulse_core::Depth`, restated here so the contract crate is self-contained
/// and the TS emitter has a single local source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[non_exhaustive]
pub enum ProjectionDepth {
    #[default]
    Beginner,
    Intermediate,
    Expert,
}

/// A pointer back to the evidence a projection rests on (docs/02 §6.3), as a
/// tagged union: `{ "kind": "flow", "id": 12 }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "id", rename_all = "lowercase")]
#[non_exhaustive]
pub enum EvidenceRefDto {
    Packet(u64),
    Flow(u64),
    Session(u64),
}

/// A narrative card's affect (docs/09 §5.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[non_exhaustive]
pub enum SeverityDto {
    #[default]
    Neutral,
    Notable,
    Finding,
}

/// One narrative feed card, already rendered at the query's depth (docs/09 §5).
/// `lines` is the depth-appropriate detail; `summary` is those lines joined for
/// the one-line under-headline view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NarrativeCardDto {
    pub headline: String,
    pub summary: String,
    pub lines: Vec<String>,
    pub severity: SeverityDto,
    pub evidence: Vec<EvidenceRefDto>,
    pub at_mono_nanos: u64,
}

/// The dimension a usage breakdown decomposes along (docs/11 §5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[non_exhaustive]
pub enum DimensionDto {
    Protocol,
    Host,
    Interface,
}

/// One row of a usage breakdown (docs/11 §5).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BreakdownRowDto {
    pub label: String,
    pub bytes: u64,
    pub flows: u32,
    pub evidence: Vec<EvidenceRefDto>,
}

/// A ranked usage breakdown (docs/11 §5).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BreakdownDto {
    pub dimension: DimensionDto,
    pub rows: Vec<BreakdownRowDto>,
}

/// The likely cause a diagnosis settles on (docs/11 §6.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum CauseDto {
    LocalWifi,
    DistantServer,
    SlowDns,
    Congestion,
}

/// A "why is it slow?" diagnosis (docs/11 §6). `confidence_percent` is the
/// calibrated confidence as a 0–100 integer for display; `explanation` is the
/// ready-to-show "looks like …" text (never a verdict, docs/11 §6.3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DiagnosisDto {
    pub cause: CauseDto,
    pub confidence_percent: u8,
    pub explanation: String,
    pub evidence: Vec<EvidenceRefDto>,
}

/// A monitoring snapshot over a window (docs/11 §5, §7). Note the two loss
/// figures are separate fields — capture loss is never network loss
/// (docs/11 §6.4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MonitorSnapshotDto {
    pub by_protocol: BreakdownDto,
    pub by_host: BreakdownDto,
    pub diagnoses: Vec<DiagnosisDto>,
    pub network_loss_indicators: u32,
    pub capture_drops: u64,
}

/// How confident a flow's process attribution is (docs/12 §5.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[non_exhaustive]
pub enum AttributionConfidenceDto {
    High,
    Low,
    Unknown,
}

/// The attributed owner of a flow (docs/12 §7). `pid` is absent when honestly
/// unattributed (docs/12 §8).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AttributionDto {
    pub pid: Option<u64>,
    pub confidence: AttributionConfidenceDto,
    pub process_name: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip<T>(value: &T)
    where
        T: Serialize + serde::de::DeserializeOwned + PartialEq + std::fmt::Debug,
    {
        let json = serde_json::to_string(value).expect("serialize");
        let back: T = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(value, &back);
    }

    #[test]
    fn evidence_ref_is_tagged() {
        let json = serde_json::to_string(&EvidenceRefDto::Flow(12)).unwrap();
        assert_eq!(json, r#"{"kind":"flow","id":12}"#);
    }

    #[test]
    fn dtos_round_trip() {
        roundtrip(&ProjectionDepth::Intermediate);
        roundtrip(&EvidenceRefDto::Session(1));
        roundtrip(&NarrativeCardDto {
            headline: "Connected to example.com".into(),
            summary: "Encrypted · 240 KB".into(),
            lines: vec!["Encrypted".into(), "240 KB from 6 servers".into()],
            severity: SeverityDto::Neutral,
            evidence: vec![EvidenceRefDto::Session(1), EvidenceRefDto::Flow(2)],
            at_mono_nanos: 1_000,
        });
        roundtrip(&MonitorSnapshotDto {
            by_protocol: BreakdownDto {
                dimension: DimensionDto::Protocol,
                rows: vec![BreakdownRowDto {
                    label: "TLS".into(),
                    bytes: 1500,
                    flows: 2,
                    evidence: vec![EvidenceRefDto::Flow(1)],
                }],
            },
            by_host: BreakdownDto {
                dimension: DimensionDto::Host,
                rows: vec![],
            },
            diagnoses: vec![DiagnosisDto {
                cause: CauseDto::SlowDns,
                confidence_percent: 70,
                explanation: "looks like slow DNS".into(),
                evidence: vec![EvidenceRefDto::Flow(1)],
            }],
            network_loss_indicators: 0,
            capture_drops: 3,
        });
        roundtrip(&AttributionDto {
            pid: None,
            confidence: AttributionConfidenceDto::Unknown,
            process_name: None,
        });
    }

    #[test]
    fn cause_uses_snake_case() {
        let json = serde_json::to_string(&CauseDto::LocalWifi).unwrap();
        assert_eq!(json, r#""local_wifi""#);
    }
}
