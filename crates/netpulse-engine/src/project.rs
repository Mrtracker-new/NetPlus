//! Projection of internal domain types into the API contract DTOs (docs/02 §7).
//!
//! The engine computes rich domain types — [`netpulse_narrative::NarrativeCard`],
//! [`crate::monitor::MonitorSnapshot`], [`crate::attribution::Attribution`] — but
//! what crosses the IPC boundary is the stable, serializable shapes in
//! `netpulse-api` (docs/04 §3.11). This module is the one place that maps
//! domain→wire, at a requested [`netpulse_core::Depth`], so a beginner query
//! never serializes expert detail (docs/09 §6.3).

use netpulse_api::dto::{
    AttributionConfidenceDto, AttributionDto, BreakdownDto, BreakdownRowDto, CauseDto,
    DiagnosisDto, DimensionDto, EvidenceRefDto, MonitorSnapshotDto, NarrativeCardDto, SeverityDto,
};
use netpulse_core::{AttributionConfidence, Depth, EvidenceRef};
use netpulse_narrative::{NarrativeCard, Severity};

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
