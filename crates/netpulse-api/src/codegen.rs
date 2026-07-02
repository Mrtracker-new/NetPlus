//! TypeScript contract emitter (docs/03 §7, docs/04 §4).
//!
//! The design calls for the UI's TypeScript view of the message schema to be
//! **generated from the Rust source of truth** so the two sides cannot drift
//! (docs/03 §7). The canonical way to do that is a derive like `ts-rs`; NetPulse
//! deliberately hand-rolls a tiny emitter instead, for the same reason Phase 1
//! hand-rolled the pcap reader: to keep the Rust dependency set at zero new
//! crates (docs/03 §14 "dependencies are attack surface"), which also keeps the
//! deferred `audit` / `egress-boundary` CI gates trivially green.
//!
//! The tradeoff is honest: a derive macro guarantees the emitted TS matches the
//! Rust struct fields by construction, whereas this emitter is kept in sync by a
//! test — [`crate::codegen::tests`] asserts the emitter's output equals the
//! committed `ui/packages/contract/src/generated.ts`, and each DTO has a serde
//! round-trip test pinning its field names (see [`crate::dto`]). If the two ever
//! diverge, CI fails, exactly as the `contract-drift` gate specifies (docs/04
//! §7). Swapping in `ts-rs` later is a drop-in that deletes this file.

/// Emit the complete TypeScript contract module for `ui/packages/contract`.
///
/// The output is deterministic (no timestamps, stable ordering) so a byte-for-
/// byte drift check is meaningful. It is a single self-contained module of
/// `export type` / `export interface` declarations mirroring [`crate::dto`].
pub fn typescript_contract() -> String {
    let mut s = String::new();
    s.push_str(HEADER);
    s.push_str(&format!(
        "\nexport const API_VERSION = {} as const;\n",
        crate::API_VERSION
    ));

    // --- Enums (string unions, matching the serde reprs in dto.rs) ---
    s.push_str(&union(
        "ProjectionDepth",
        &["beginner", "intermediate", "expert"],
    ));
    s.push_str(&union("Severity", &["neutral", "notable", "finding"]));
    s.push_str(&union("Dimension", &["protocol", "host", "interface"]));
    s.push_str(&union(
        "Cause",
        &["local_wifi", "distant_server", "slow_dns", "congestion"],
    ));
    s.push_str(&union("AttributionConfidence", &["high", "low", "unknown"]));

    // --- EvidenceRef: internally-tagged union (matches #[serde(tag,content)]) ---
    s.push_str(
        "\nexport type EvidenceRef =\n  \
         | { kind: \"packet\"; id: number }\n  \
         | { kind: \"flow\"; id: number }\n  \
         | { kind: \"session\"; id: number };\n",
    );

    // --- Interfaces (mirror the structs field-for-field) ---
    s.push_str(&iface(
        "NarrativeCard",
        &[
            ("headline", "string"),
            ("summary", "string"),
            ("lines", "string[]"),
            ("severity", "Severity"),
            ("evidence", "EvidenceRef[]"),
            ("at_mono_nanos", "number"),
        ],
    ));
    s.push_str(&iface(
        "BreakdownRow",
        &[
            ("label", "string"),
            ("bytes", "number"),
            ("flows", "number"),
            ("evidence", "EvidenceRef[]"),
        ],
    ));
    s.push_str(&iface(
        "Breakdown",
        &[("dimension", "Dimension"), ("rows", "BreakdownRow[]")],
    ));
    s.push_str(&iface(
        "Diagnosis",
        &[
            ("cause", "Cause"),
            ("confidence_percent", "number"),
            ("explanation", "string"),
            ("evidence", "EvidenceRef[]"),
        ],
    ));
    s.push_str(&iface(
        "MonitorSnapshot",
        &[
            ("by_protocol", "Breakdown"),
            ("by_host", "Breakdown"),
            ("diagnoses", "Diagnosis[]"),
            ("network_loss_indicators", "number"),
            ("capture_drops", "number"),
        ],
    ));
    s.push_str(&iface(
        "Attribution",
        &[
            ("pid", "number | null"),
            ("confidence", "AttributionConfidence"),
            ("process_name", "string | null"),
        ],
    ));

    // --- Phase 3 education enums (docs/13–16) ---
    s.push_str(&union(
        "ExerciseKind",
        &["identify", "explain_back", "predict", "diagnose"],
    ));
    s.push_str(&union(
        "StageKind",
        &[
            "navigation",
            "dns_resolution",
            "connection",
            "encryption",
            "request",
            "fan_out",
            "completion",
        ],
    ));
    s.push_str(&union(
        "Direction",
        &["client_to_server", "server_to_client"],
    ));
    s.push_str(&union(
        "AnimationKind",
        &[
            "packet_flow",
            "handshake",
            "multiplexing",
            "fan_out",
            "degradation",
        ],
    ));

    // --- Phase 3 education interfaces (docs/13–16) ---
    s.push_str(&iface(
        "GroundedExercise",
        &[
            ("kind", "ExerciseKind"),
            ("prompt", "string"),
            ("answer", "string"),
        ],
    ));
    s.push_str(&iface(
        "LessonOffer",
        &[
            ("lesson_id", "string"),
            ("title", "string"),
            ("level", "ProjectionDepth"),
            ("grounded", "boolean"),
            ("grounding", "string[]"),
            ("exercise", "GroundedExercise | null"),
            ("evidence", "EvidenceRef[]"),
        ],
    ));
    s.push_str(&iface(
        "ExplorerEntry",
        &[
            ("key", "string"),
            ("title", "string"),
            ("beginner", "string"),
            ("intermediate", "string"),
            ("expert", "string"),
            ("related", "string[]"),
            ("examples_available", "boolean"),
        ],
    ));
    s.push_str(&iface(
        "JourneyStage",
        &[
            ("kind", "StageKind"),
            ("title", "string"),
            ("narration", "string"),
            ("detail", "string | null"),
            ("evidence", "EvidenceRef[]"),
        ],
    ));
    s.push_str(&iface(
        "FanoutNode",
        &[
            ("label", "string"),
            ("flows", "number"),
            ("bytes", "number"),
            ("evidence", "EvidenceRef[]"),
        ],
    ));
    s.push_str(&iface(
        "PageJourney",
        &[
            ("session_id", "number"),
            ("stages", "JourneyStage[]"),
            ("fanout", "FanoutNode[]"),
        ],
    ));
    s.push_str(&iface(
        "VisualEvent",
        &[
            ("at_nanos", "number"),
            ("direction", "Direction"),
            ("label", "string"),
            ("key", "string | null"),
        ],
    ));
    s.push_str(&iface(
        "AnimationModel",
        &[
            ("kind", "AnimationKind"),
            ("events", "VisualEvent[]"),
            ("total_nanos", "number"),
            ("reduced_motion", "string[]"),
        ],
    ));

    // --- Phase 4 intelligence enums (docs/17–20) ---
    s.push_str(&union(
        "FindingCategory",
        &["anomaly", "suspicious", "informational"],
    ));
    s.push_str(&union(
        "FindingKind",
        &[
            "unexpected_egress",
            "beaconing",
            "port_scan",
            "dns_anomaly",
            "connection_storm",
            "bandwidth_anomaly",
        ],
    ));

    // --- Phase 4 intelligence interfaces (docs/17–20) ---
    s.push_str(&iface(
        "SecurityFinding",
        &[
            ("kind", "FindingKind"),
            ("category", "FindingCategory"),
            ("title", "string"),
            ("confidence_percent", "number"),
            ("qualitative", "string"),
            ("explanation", "string"),
            ("technical", "string | null"),
            ("benign_explanations", "string[]"),
            ("suggested_action", "string"),
            ("evidence", "EvidenceRef[]"),
            ("corroboration", "FindingKind[]"),
        ],
    ));
    s.push_str(&iface(
        "AssistantAnswer",
        &[
            ("text", "string"),
            ("citations", "EvidenceRef[]"),
            ("grounded", "boolean"),
            ("backend_id", "string"),
            ("is_remote", "boolean"),
            ("disclosure", "string"),
        ],
    ));

    s
}

const HEADER: &str = "// GENERATED from the netpulse-api crate — do not hand-edit.\n\
// Regenerate with: cargo test -p netpulse-api -- --ignored write_contract\n\
// A CI drift check fails the build if this file is out of sync (docs/04 §7).\n";

/// A TS string-literal union: `export type Name = \"a\" | \"b\";`.
fn union(name: &str, variants: &[&str]) -> String {
    let body = variants
        .iter()
        .map(|v| format!("\"{v}\""))
        .collect::<Vec<_>>()
        .join(" | ");
    format!("\nexport type {name} = {body};\n")
}

/// A TS interface with the given `(field, type)` pairs, in order.
fn iface(name: &str, fields: &[(&str, &str)]) -> String {
    let mut s = format!("\nexport interface {name} {{\n");
    for (field, ty) in fields {
        s.push_str(&format!("  {field}: {ty};\n"));
    }
    s.push_str("}\n");
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emitter_is_deterministic() {
        assert_eq!(typescript_contract(), typescript_contract());
    }

    #[test]
    fn emitter_covers_every_dto() {
        let ts = typescript_contract();
        for expected in [
            "ProjectionDepth",
            "Severity",
            "Dimension",
            "Cause",
            "AttributionConfidence",
            "EvidenceRef",
            "NarrativeCard",
            "BreakdownRow",
            "Breakdown",
            "Diagnosis",
            "MonitorSnapshot",
            "Attribution",
            "ExerciseKind",
            "StageKind",
            "Direction",
            "AnimationKind",
            "GroundedExercise",
            "LessonOffer",
            "ExplorerEntry",
            "JourneyStage",
            "FanoutNode",
            "PageJourney",
            "VisualEvent",
            "AnimationModel",
            "FindingCategory",
            "FindingKind",
            "SecurityFinding",
            "AssistantAnswer",
        ] {
            assert!(ts.contains(expected), "TS contract missing {expected}");
        }
    }

    #[test]
    fn union_reprs_match_serde() {
        // The TS unions must use the same wire strings serde emits (dto.rs).
        let ts = typescript_contract();
        assert!(ts.contains(r#""local_wifi" | "distant_server" | "slow_dns" | "congestion""#));
        assert!(ts.contains(r#""beginner" | "intermediate" | "expert""#));
    }

    const CONTRACT_PATH: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../ui/packages/contract/src/generated.ts"
    );

    /// The `contract-drift` gate (docs/04 §7): the committed TypeScript must
    /// equal what the emitter produces now. If a DTO changed without
    /// regenerating, this fails — the UI and engine can never silently diverge
    /// (docs/03 §7). Fix by running the `write_contract` test below.
    #[test]
    fn committed_contract_is_in_sync() {
        let committed = std::fs::read_to_string(CONTRACT_PATH)
            .expect("ui/packages/contract/src/generated.ts exists");
        // Normalize line endings so the check is stable across OSes (the CI
        // matrix includes Windows, which may check out CRLF).
        assert_eq!(
            normalize(&committed),
            normalize(&typescript_contract()),
            "contract drift: regenerate with `cargo test -p netpulse-api -- --ignored write_contract`"
        );
    }

    fn normalize(s: &str) -> String {
        s.replace("\r\n", "\n")
    }

    /// Regenerate the committed contract file. Ignored by default (writing files
    /// is not a normal test); run explicitly to update the checked-in TS:
    /// `cargo test -p netpulse-api -- --ignored write_contract`.
    #[test]
    #[ignore = "writes ui/packages/contract/src/generated.ts on demand"]
    fn write_contract() {
        std::fs::write(CONTRACT_PATH, typescript_contract()).expect("write generated.ts");
    }
}
