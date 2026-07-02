//! Projection of internal domain types into the API contract DTOs (docs/02 §7).
//!
//! The engine computes rich domain types — [`netpulse_narrative::NarrativeCard`],
//! [`crate::monitor::MonitorSnapshot`], [`crate::attribution::Attribution`] — but
//! what crosses the IPC boundary is the stable, serializable shapes in
//! `netpulse-api` (docs/04 §3.11). This module is the one place that maps
//! domain→wire, at a requested [`netpulse_core::Depth`], so a beginner query
//! never serializes expert detail (docs/09 §6.3).

use netpulse_api::dto::{
    AnimationKindDto, AnimationModelDto, AttributionConfidenceDto, AttributionDto, BreakdownDto,
    BreakdownRowDto, CauseDto, DiagnosisDto, DimensionDto, DirectionDto, EvidenceRefDto,
    ExerciseKindDto, ExplorerEntryDto, FanoutNodeDto, GroundedExerciseDto, JourneyStageDto,
    LessonOfferDto, MonitorSnapshotDto, NarrativeCardDto, PageJourneyDto, ProjectionDepth,
    SeverityDto, StageKindDto, VisualEventDto,
};
use netpulse_core::{AttributionConfidence, Depth, EvidenceRef};
use netpulse_learn::anim::{AnimationKind, AnimationModel, Direction, VisualEvent};
use netpulse_learn::content::{ExerciseKind, Level};
use netpulse_learn::{ExplorerEntry, GroundedExercise, LessonOffer};
use netpulse_narrative::{
    FanoutNode, JourneyStage, NarrativeCard, PageJourney, Severity, StageKind,
};

use crate::attribution::Attribution;
use crate::monitor::{Breakdown, Cause, Diagnosis, Dimension, MonitorSnapshot};

/// Project a narrative card to its wire DTO at `depth` (docs/09 §5, §6.3). The
/// visible `lines`/`summary` are exactly what the card discloses at that depth;
/// the evidence travels in full so drill-down still reaches everything.
pub fn card_dto(card: &NarrativeCard, depth: Depth) -> NarrativeCardDto {
    // render() returns [headline, ...lines]; the DTO carries lines without the
    // headline (which is its own field), so drop the leading element.
    let mut rendered = card.render(depth);
    let lines = if rendered.is_empty() {
        Vec::new()
    } else {
        rendered.split_off(1)
    };
    NarrativeCardDto {
        headline: card.headline.clone(),
        summary: card.summary(depth),
        lines,
        severity: severity_dto(card.severity),
        evidence: card.evidence().iter().map(evidence_dto).collect(),
        at_mono_nanos: card.at_mono_nanos,
    }
}

fn severity_dto(s: Severity) -> SeverityDto {
    match s {
        Severity::Neutral => SeverityDto::Neutral,
        Severity::Notable => SeverityDto::Notable,
        Severity::Finding => SeverityDto::Finding,
        // A future severity we don't yet render: fall back to Notable rather
        // than Neutral, so an unknown-but-flagged card is never silently calmed.
        _ => SeverityDto::Notable,
    }
}

fn evidence_dto(e: &EvidenceRef) -> EvidenceRefDto {
    match e {
        EvidenceRef::Packet(id) => EvidenceRefDto::Packet(*id),
        EvidenceRef::Flow(id) => EvidenceRefDto::Flow(*id),
        EvidenceRef::Session(id) => EvidenceRefDto::Session(*id),
        // `EvidenceRef` is #[non_exhaustive]; a future variant maps to a Flow=0
        // placeholder so the link is present but obviously not resolvable, rather
        // than dropping evidence and breaking the invariant silently (docs/02 §6.3).
        _ => EvidenceRefDto::Flow(0),
    }
}

/// Project a monitoring snapshot to its wire DTO (docs/11 §5). The two loss
/// figures stay in separate fields — capture loss is never network loss
/// (docs/11 §6.4).
pub fn monitor_dto(snap: &MonitorSnapshot) -> MonitorSnapshotDto {
    MonitorSnapshotDto {
        by_protocol: breakdown_dto(&snap.by_protocol),
        by_host: breakdown_dto(&snap.by_host),
        diagnoses: snap.diagnoses.iter().map(diagnosis_dto).collect(),
        network_loss_indicators: snap.loss.network_loss_indicators,
        capture_drops: snap.loss.capture_drops,
    }
}

fn breakdown_dto(b: &Breakdown) -> BreakdownDto {
    BreakdownDto {
        dimension: match b.dimension {
            Dimension::Protocol => DimensionDto::Protocol,
            Dimension::Host => DimensionDto::Host,
            Dimension::Interface => DimensionDto::Interface,
        },
        rows: b
            .rows
            .iter()
            .map(|r| BreakdownRowDto {
                label: r.label.clone(),
                bytes: r.bytes,
                flows: r.flows,
                evidence: r.evidence.iter().map(evidence_dto).collect(),
            })
            .collect(),
    }
}

fn diagnosis_dto(d: &Diagnosis) -> DiagnosisDto {
    DiagnosisDto {
        cause: match d.cause {
            Cause::LocalWifi => CauseDto::LocalWifi,
            Cause::DistantServer => CauseDto::DistantServer,
            Cause::SlowDns => CauseDto::SlowDns,
            Cause::Congestion => CauseDto::Congestion,
        },
        // Confidence is 0.0..=1.0; present it as a 0–100 integer for display
        // (docs/11 §6.2 "Confidence: 68%"). Rounded, not truncated.
        confidence_percent: (d.confidence.value() * 100.0).round() as u8,
        explanation: d.explanation.clone(),
        evidence: d.evidence.iter().map(evidence_dto).collect(),
    }
}

/// Project a flow attribution to its wire DTO (docs/12 §7). `process_name` is
/// supplied by the caller (from a [`netpulse_core::traits::SocketTableSource`]
/// lookup); `None` when unattributed or not yet enriched.
pub fn attribution_dto(a: &Attribution, process_name: Option<String>) -> AttributionDto {
    AttributionDto {
        pid: a.pid,
        confidence: match a.confidence {
            AttributionConfidence::High => AttributionConfidenceDto::High,
            AttributionConfidence::Low => AttributionConfidenceDto::Low,
            AttributionConfidence::Unknown => AttributionConfidenceDto::Unknown,
            _ => AttributionConfidenceDto::Unknown,
        },
        // A name is only meaningful when we actually attributed a PID.
        process_name: a.pid.and(process_name),
    }
}

// ===== Phase 3 — education projections (docs/13–16) ========================

/// Map a learner `Level` to the wire projection depth — they share one ladder
/// (docs/13 §3.1, docs/09 §6).
fn level_dto(level: Level) -> ProjectionDepth {
    match level {
        Level::Beginner => ProjectionDepth::Beginner,
        Level::Intermediate => ProjectionDepth::Intermediate,
        Level::Expert => ProjectionDepth::Expert,
        _ => ProjectionDepth::Expert,
    }
}

fn exercise_kind_dto(kind: ExerciseKind) -> ExerciseKindDto {
    match kind {
        ExerciseKind::Identify => ExerciseKindDto::Identify,
        ExerciseKind::ExplainBack => ExerciseKindDto::ExplainBack,
        ExerciseKind::Predict => ExerciseKindDto::Predict,
        ExerciseKind::Diagnose => ExerciseKindDto::Diagnose,
        _ => ExerciseKindDto::Identify,
    }
}

fn grounded_exercise_dto(ex: &GroundedExercise) -> GroundedExerciseDto {
    GroundedExerciseDto {
        kind: exercise_kind_dto(ex.kind),
        prompt: ex.prompt.clone(),
        answer: ex.answer.clone(),
    }
}

/// Project a grounded lesson offer to its wire DTO (docs/13 §4). Evidence travels
/// in full so the offer stays auditable (docs/02 §6.3).
pub fn lesson_offer_dto(offer: &LessonOffer) -> LessonOfferDto {
    LessonOfferDto {
        lesson_id: offer.lesson_id.to_string(),
        title: offer.title.to_string(),
        level: level_dto(offer.level),
        grounded: offer.grounded,
        grounding: offer.grounding.clone(),
        exercise: offer.exercise.as_ref().map(grounded_exercise_dto),
        evidence: offer.evidence.iter().map(evidence_dto).collect(),
    }
}

/// Project a protocol-explorer entry to its wire DTO (docs/15 §4, §6).
pub fn explorer_entry_dto(entry: &ExplorerEntry) -> ExplorerEntryDto {
    ExplorerEntryDto {
        key: entry.key.to_string(),
        title: entry.title.clone(),
        beginner: entry.beginner.to_string(),
        intermediate: entry.intermediate.to_string(),
        expert: entry.expert.to_string(),
        related: entry.related.iter().map(|k| k.to_string()).collect(),
        examples_available: entry.examples_available,
    }
}

fn stage_kind_dto(kind: StageKind) -> StageKindDto {
    match kind {
        StageKind::Navigation => StageKindDto::Navigation,
        StageKind::DnsResolution => StageKindDto::DnsResolution,
        StageKind::Connection => StageKindDto::Connection,
        StageKind::Encryption => StageKindDto::Encryption,
        StageKind::Request => StageKindDto::Request,
        StageKind::FanOut => StageKindDto::FanOut,
        StageKind::Completion => StageKindDto::Completion,
        _ => StageKindDto::Completion,
    }
}

fn journey_stage_dto(stage: &JourneyStage, depth: Depth) -> JourneyStageDto {
    JourneyStageDto {
        kind: stage_kind_dto(stage.kind),
        title: stage.title.clone(),
        narration: stage.narration.clone(),
        // The technical detail line is disclosed at Intermediate+ (docs/14 §7);
        // a beginner sees the story, not the timings.
        detail: if depth.shows(Depth::Intermediate) {
            stage.detail.clone()
        } else {
            None
        },
        evidence: stage.evidence.iter().map(evidence_dto).collect(),
    }
}

fn fanout_node_dto(node: &FanoutNode) -> FanoutNodeDto {
    FanoutNodeDto {
        label: node.label.clone(),
        flows: node.flows as u32,
        bytes: node.bytes,
        evidence: node.evidence.iter().map(evidence_dto).collect(),
    }
}

/// Project a website journey to its wire DTO at `depth` (docs/14 §6, §7).
pub fn page_journey_dto(journey: &PageJourney, depth: Depth) -> PageJourneyDto {
    PageJourneyDto {
        session_id: journey.session_id,
        stages: journey
            .stages
            .iter()
            .map(|s| journey_stage_dto(s, depth))
            .collect(),
        fanout: journey.fanout.iter().map(fanout_node_dto).collect(),
    }
}

fn direction_dto(d: Direction) -> DirectionDto {
    match d {
        Direction::ClientToServer => DirectionDto::ClientToServer,
        Direction::ServerToClient => DirectionDto::ServerToClient,
        _ => DirectionDto::ClientToServer,
    }
}

fn animation_kind_dto(k: AnimationKind) -> AnimationKindDto {
    match k {
        AnimationKind::PacketFlow => AnimationKindDto::PacketFlow,
        AnimationKind::Handshake => AnimationKindDto::Handshake,
        AnimationKind::Multiplexing => AnimationKindDto::Multiplexing,
        AnimationKind::FanOut => AnimationKindDto::FanOut,
        AnimationKind::Degradation => AnimationKindDto::Degradation,
        _ => AnimationKindDto::PacketFlow,
    }
}

fn visual_event_dto(e: &VisualEvent) -> VisualEventDto {
    VisualEventDto {
        at_nanos: e.at_nanos,
        direction: direction_dto(e.direction),
        label: e.label.clone(),
        key: e.key.map(|k| k.as_str().to_string()),
    }
}

/// Project an animation model to its wire DTO (docs/16 §5). The mandatory
/// reduced-motion equivalent (docs/16 §8) is computed here so it always ships.
pub fn animation_model_dto(model: &AnimationModel) -> AnimationModelDto {
    AnimationModelDto {
        kind: animation_kind_dto(model.kind),
        events: model.events.iter().map(visual_event_dto).collect(),
        total_nanos: model.total_nanos,
        reduced_motion: model.reduced_motion_steps(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_core::EvidenceRef;
    use netpulse_narrative::NarrativeCard;

    #[test]
    fn card_dto_respects_depth() {
        let card = NarrativeCard::new("Connected to x", 1_000, vec![EvidenceRef::Session(1)])
            .line(Depth::Beginner, "Encrypted")
            .line(Depth::Expert, "seq/ack detail");
        let beginner = card_dto(&card, Depth::Beginner);
        let expert = card_dto(&card, Depth::Expert);
        assert_eq!(beginner.lines, vec!["Encrypted"]);
        assert_eq!(expert.lines.len(), 2);
        // Evidence always travels in full, regardless of depth (docs/09 §8).
        assert_eq!(beginner.evidence, vec![EvidenceRefDto::Session(1)]);
    }

    #[test]
    fn unattributed_flow_carries_no_name() {
        let a = Attribution::unknown();
        let dto = attribution_dto(&a, Some("chrome".into()));
        assert_eq!(dto.pid, None);
        assert_eq!(dto.process_name, None, "no PID → no name");
        assert_eq!(dto.confidence, AttributionConfidenceDto::Unknown);
    }
}
