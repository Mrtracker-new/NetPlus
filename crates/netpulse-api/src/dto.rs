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

// ===== Phase 3 — Education (docs/13–16) ====================================
//
// The wire projections of the education surfaces. Like the Phase 2 DTOs above,
// these are deliberately distinct from the rich domain types in `netpulse-learn`
// / `netpulse-narrative`; the engine maps down into these stable shapes. Every
// one that asserts something about the learner's traffic carries `evidence`
// (docs/02 §6.3). The `level` field reuses [`ProjectionDepth`] because a lesson's
// level and the UI disclosure mode share one ladder (docs/13 §3.1, docs/09 §6).

/// The kind of comprehension check (docs/13 §5.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum ExerciseKindDto {
    Identify,
    ExplainBack,
    Predict,
    Diagnose,
}

/// A comprehension check derived from the learner's own capture (docs/13 §5.1).
/// The `answer` is computed from real evidence, so it cannot be wrong about the
/// learner's data (docs/13 §11) — kept local, never uploaded (docs/13 §6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GroundedExerciseDto {
    pub kind: ExerciseKindDto,
    pub prompt: String,
    pub answer: String,
}

/// A lesson offered because a real teachable moment occurred (docs/13 §3.2).
/// Calm and dismissible in the UI (docs/13 §6). `grounded` is false only for a
/// curated-example fallback, shown honestly as such (docs/13 §4.3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LessonOfferDto {
    pub lesson_id: String,
    pub title: String,
    pub level: ProjectionDepth,
    pub grounded: bool,
    pub grounding: Vec<String>,
    pub exercise: Option<GroundedExerciseDto>,
    pub evidence: Vec<EvidenceRefDto>,
}

/// One reference entry in the Protocol Explorer (docs/15 §4, §6): layered
/// content plus navigation. `examples_available` reflects a real storage lookup
/// (docs/15 §5), never a guess.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExplorerEntryDto {
    pub key: String,
    pub title: String,
    pub beginner: String,
    pub intermediate: String,
    pub expert: String,
    pub related: Vec<String>,
    pub examples_available: bool,
}

/// A stage of a website journey (docs/14 §4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum StageKindDto {
    Navigation,
    DnsResolution,
    Connection,
    Encryption,
    Request,
    FanOut,
    Completion,
}

/// One narrated journey stage (docs/14 §4, §6). `detail` is the intermediate+
/// technical line, disclosed progressively (docs/14 §7).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JourneyStageDto {
    pub kind: StageKindDto,
    pub title: String,
    pub narration: String,
    pub detail: Option<String>,
    pub evidence: Vec<EvidenceRefDto>,
}

/// One node of the CDN/organization fan-out (docs/14 §5).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FanoutNodeDto {
    pub label: String,
    pub flows: u32,
    pub bytes: u64,
    pub evidence: Vec<EvidenceRefDto>,
}

/// The complete website journey for one session (docs/14 §3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PageJourneyDto {
    pub session_id: u64,
    pub stages: Vec<JourneyStageDto>,
    pub fanout: Vec<FanoutNodeDto>,
}

/// Which way a visual element moves (docs/16 §3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum DirectionDto {
    ClientToServer,
    ServerToClient,
}

/// The concept an animation makes legible (docs/16 §4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum AnimationKindDto {
    PacketFlow,
    Handshake,
    Multiplexing,
    FanOut,
    Degradation,
}

/// One timed, typed visual event on the real timeline (docs/16 §5). `key` ties
/// the element to its explanation (docs/07 §7). Colour is deliberately absent —
/// styling lives in the design system (docs/16 §6), not the wire model.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VisualEventDto {
    pub at_nanos: u64,
    pub direction: DirectionDto,
    pub label: String,
    pub key: Option<String>,
}

/// A complete animation model (docs/16 §5). `reduced_motion` is the mandatory
/// static/step-through equivalent (docs/16 §8) — always present, so a
/// reduced-motion or screen-reader user gets the same events as text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnimationModelDto {
    pub kind: AnimationKindDto,
    pub events: Vec<VisualEventDto>,
    pub total_nanos: u64,
    pub reduced_motion: Vec<String>,
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

    #[test]
    fn education_dtos_round_trip() {
        roundtrip(&LessonOfferDto {
            lesson_id: "b5.encryption".into(),
            title: "Encryption: why the padlock".into(),
            level: ProjectionDepth::Beginner,
            grounded: true,
            grounding: vec!["Your connection to example.com was encrypted (TLS).".into()],
            exercise: Some(GroundedExerciseDto {
                kind: ExerciseKindDto::ExplainBack,
                prompt: "What did the ClientHello propose?".into(),
                answer: "TLS versions and cipher suites".into(),
            }),
            evidence: vec![EvidenceRefDto::Session(7), EvidenceRefDto::Flow(10)],
        });
        roundtrip(&ExplorerEntryDto {
            key: "tcp.flags.syn".into(),
            title: "TCP flags syn".into(),
            beginner: "starts a connection".into(),
            intermediate: "opens a connection".into(),
            expert: "TCP SYN control bit".into(),
            related: vec!["tcp.flags.ack".into()],
            examples_available: true,
        });
        roundtrip(&PageJourneyDto {
            session_id: 1,
            stages: vec![JourneyStageDto {
                kind: StageKindDto::DnsResolution,
                title: "DNS resolution".into(),
                narration: "Your computer looked up example.com.".into(),
                detail: Some("DNS resolved in 12 ms".into()),
                evidence: vec![EvidenceRefDto::Session(1)],
            }],
            fanout: vec![FanoutNodeDto {
                label: "Cloudflare".into(),
                flows: 2,
                bytes: 300,
                evidence: vec![EvidenceRefDto::Flow(1)],
            }],
        });
        roundtrip(&AnimationModelDto {
            kind: AnimationKindDto::Handshake,
            events: vec![VisualEventDto {
                at_nanos: 0,
                direction: DirectionDto::ClientToServer,
                label: "SYN".into(),
                key: Some("tcp.flags.syn".into()),
            }],
            total_nanos: 30_000_000,
            reduced_motion: vec!["0.0 ms · SYN (you → server)".into()],
        });
    }

    #[test]
    fn education_enums_use_snake_case() {
        // The TS emitter mirrors these exact wire strings; a mismatch fails the
        // drift gate (docs/04 §7).
        assert_eq!(
            serde_json::to_string(&ExerciseKindDto::ExplainBack).unwrap(),
            r#""explain_back""#
        );
        assert_eq!(
            serde_json::to_string(&StageKindDto::DnsResolution).unwrap(),
            r#""dns_resolution""#
        );
        assert_eq!(
            serde_json::to_string(&AnimationKindDto::FanOut).unwrap(),
            r#""fan_out""#
        );
        assert_eq!(
            serde_json::to_string(&DirectionDto::ClientToServer).unwrap(),
            r#""client_to_server""#
        );
    }
}
