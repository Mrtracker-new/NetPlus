//! The education presentation: the read-only projection of
//! a committed capture into what the learning surfaces show — grounded lesson
//! offers, staged website journeys, the browsable protocol reference, and the
//! data-driven handshake animation model.
//!
//! Like [`crate::pipeline::present`], this is a pure *view* over the
//! store: it runs off the hot path, gathers the
//! reconstruction the caller already committed, and hands the education engines
//! (`netpulse-learn`, `netpulse-narrative`) exactly the slices they need. It
//! projects the results down into the stable `netpulse-api` wire DTOs at the
//! requested [`Depth`], so a beginner journey never serializes expert detail
//!No new capture, parse, or storage — one source of truth.

use netpulse_api::dto::{
    AnimationModelDto, CurriculumModuleDto, ExerciseChoiceDto, ExerciseValidationOutcomeDto,
    ExplorerEntryDto, LearningProgressDto, LessonDetailDto, LessonExerciseDto, LessonOfferDto,
    LessonStepDto, PageJourneyDto,
};
use netpulse_core::{Depth, Flow, ProtoEvent, Session};
use netpulse_decode::ExplanationKey;
use netpulse_learn::{
    browse, detect_offers, examples_for, search, tcp_handshake, validate_exercise_choice,
    ExplorerEntry, ProgressStore, TrafficView, CURRICULUM,
};
use netpulse_narrative::{build_page_journey, SessionView};
use netpulse_storage::CaptureStore;

use crate::project;

/// The education projection of a committed run. The bundle a
/// learning UI receives: grounded offers, one journey per session, and the
/// protocol reference with real "your examples" availability wired in.
#[derive(Debug, Clone)]
pub struct EducationView {
    /// Grounded lesson offers across every session's teachable moments
    /// most-fundamental first.
    pub offers: Vec<LessonOfferDto>,
    /// One staged website journey per session, depth-projected.
    pub journeys: Vec<PageJourneyDto>,
    /// The browsable protocol reference, with `examples_available`
    /// set from the learner's real flows.
    pub reference: Vec<ExplorerEntryDto>,
}

/// Build the education view from a committed store at `depth`.
pub fn present_education(store: &CaptureStore, depth: Depth) -> EducationView {
    // Own the per-session flow/event clones so the borrowed views can reference
    // them while the education engines run (the projection is fed by the caller,
    // which gathers from storage).
    let session_ids = store.session_ids();
    let mut owned: Vec<(Session, Vec<Flow>, Vec<ProtoEvent>)> =
        Vec::with_capacity(session_ids.len());
    for sid in session_ids {
        let Some(session) = store.session(sid) else {
            continue;
        };
        let flows: Vec<Flow> = store.flows_for_session(sid).into_iter().cloned().collect();
        let mut events: Vec<ProtoEvent> = Vec::new();
        for f in &flows {
            events.extend(store.events_for_flow(f.id).iter().cloned());
        }
        owned.push((session.clone(), flows, events));
    }

    let mut offers = Vec::new();
    let mut journeys = Vec::new();
    for (session, flows, events) in &owned {
        // Grounded lesson offers for this session's teachable moments.
        let tview = TrafficView {
            session: Some(session),
            flows,
            events,
        };
        for offer in detect_offers(&tview) {
            offers.push(project::lesson_offer_dto(&offer));
        }

        // The staged website journey for this session.
        let sview = SessionView::new(session, flows.iter().collect(), events.iter().collect());
        let journey = build_page_journey(&sview);
        journeys.push(project::page_journey_dto(&journey, depth));
    }

    // The protocol reference, with real "your examples" availability.
    let reference = entries_with_examples(store, browse());

    EducationView {
        offers,
        journeys,
        reference,
    }
}

/// Project the full curriculum and progress summary.
pub fn curriculum_view(
    store: &CaptureStore,
    progress_store: &ProgressStore,
) -> (Vec<CurriculumModuleDto>, LearningProgressDto) {
    let all_flows: Vec<Flow> = store
        .flows_in_window(0, u64::MAX)
        .into_iter()
        .cloned()
        .collect();

    let mut grounded_ids = std::collections::HashSet::new();
    for module in CURRICULUM {
        for l in module.lessons {
            let has_grounding = l
                .steps
                .iter()
                .any(|step| !examples_for(step.body_key, &all_flows).is_empty());
            if has_grounding {
                grounded_ids.insert(l.id.to_string());
            }
        }
    }

    let modules = CURRICULUM
        .iter()
        .map(|m| project::curriculum_module_dto(m, progress_store, &grounded_ids))
        .collect();

    let summary = project::learning_progress_dto(&progress_store.summary());

    (modules, summary)
}

/// Project detailed workspace data for one lesson.
pub fn lesson_detail_view(
    store: &CaptureStore,
    progress_store: &ProgressStore,
    lesson_id: &str,
    depth: Depth,
) -> Option<LessonDetailDto> {
    let l = netpulse_learn::lesson(lesson_id)?;
    let p = progress_store.get(lesson_id);
    let status_str = match p.status {
        netpulse_learn::LessonStatus::NotStarted => "not_started",
        netpulse_learn::LessonStatus::InProgress => "in_progress",
        netpulse_learn::LessonStatus::Completed => "completed",
        netpulse_learn::LessonStatus::Mastered => "mastered",
        _ => "not_started",
    };

    let d_depth = match depth {
        Depth::Beginner => netpulse_decode::DisclosureDepth::Beginner,
        Depth::Intermediate => netpulse_decode::DisclosureDepth::Intermediate,
        Depth::Expert | _ => netpulse_decode::DisclosureDepth::Expert,
    };

    let steps: Vec<LessonStepDto> = l
        .steps
        .iter()
        .map(|s| {
            let expl = netpulse_decode::explain(s.body_key);
            let content = expl
                .as_ref()
                .map(|e| e.at(d_depth))
                .unwrap_or("")
                .to_string();
            let title = s.body_key.as_str().to_string();
            let anim_str = s.anim.map(|a| {
                match a {
                    netpulse_learn::AnimationRef::TcpHandshake => "tcp_handshake",
                    netpulse_learn::AnimationRef::TlsHandshake => "tls_handshake",
                    netpulse_learn::AnimationRef::Multiplexing => "multiplexing",
                    netpulse_learn::AnimationRef::FanOut => "fan_out",
                    netpulse_learn::AnimationRef::Degradation => "degradation",
                    _ => "tcp_handshake",
                }
                .to_string()
            });

            LessonStepDto {
                id: s.id.to_string(),
                body_key: s.body_key.as_str().to_string(),
                title,
                content,
                anim: anim_str,
            }
        })
        .collect();

    let exercises: Vec<LessonExerciseDto> = l
        .exercises
        .iter()
        .map(|e| {
            let kind_dto = match e.kind {
                netpulse_learn::ExerciseKind::Identify => {
                    netpulse_api::dto::ExerciseKindDto::Identify
                }
                netpulse_learn::ExerciseKind::ExplainBack => {
                    netpulse_api::dto::ExerciseKindDto::ExplainBack
                }
                netpulse_learn::ExerciseKind::Predict => {
                    netpulse_api::dto::ExerciseKindDto::Predict
                }
                netpulse_learn::ExerciseKind::Diagnose => {
                    netpulse_api::dto::ExerciseKindDto::Diagnose
                }
                _ => netpulse_api::dto::ExerciseKindDto::Identify,
            };
            let choices = e
                .choices
                .iter()
                .map(|c| ExerciseChoiceDto {
                    id: c.id.to_string(),
                    text: c.text.to_string(),
                })
                .collect();

            LessonExerciseDto {
                id: e.id.to_string(),
                kind: kind_dto,
                prompt: e.prompt.to_string(),
                choices,
                explanation: e.explanation.to_string(),
            }
        })
        .collect();

    let (evidence, grounding, animation) = find_lesson_grounding(store, l);

    Some(LessonDetailDto {
        lesson_id: l.id.to_string(),
        title: l.title.to_string(),
        level: project::level_dto(l.level),
        prerequisites: l.prerequisites.iter().map(|s| s.to_string()).collect(),
        objectives: l.objectives.iter().map(|s| s.to_string()).collect(),
        related_concepts: l.related_concepts.iter().map(|s| s.to_string()).collect(),
        steps,
        exercises,
        animation,
        evidence,
        grounding,
        status: status_str.to_string(),
        mastery: p.mastery,
    })
}

fn find_lesson_grounding(
    store: &CaptureStore,
    lesson: &netpulse_learn::Lesson,
) -> (
    Vec<netpulse_api::dto::EvidenceRefDto>,
    Vec<String>,
    Option<AnimationModelDto>,
) {
    let mut evidence = Vec::new();
    let mut grounding = Vec::new();
    let mut animation = None;

    let all_flows: Vec<Flow> = store
        .flows_in_window(0, u64::MAX)
        .into_iter()
        .cloned()
        .collect();

    for flow in &all_flows {
        if let Some(rtt) = flow.stats.rtt_estimate_nanos {
            if animation.is_none() && (lesson.id == "b4.handshake" || lesson.id == "b2.pageload") {
                let model = tcp_handshake(rtt);
                animation = Some(project::animation_model_dto(&model));
            }
        }
        for step in lesson.steps {
            if !examples_for(step.body_key, std::slice::from_ref(flow)).is_empty() {
                evidence.push(netpulse_api::dto::EvidenceRefDto::Flow(flow.id));
                grounding.push(format!(
                    "Observed in flow {} ({}:{})",
                    flow.id, flow.key.dst_ip, flow.key.dst_port
                ));
                break;
            }
        }
    }

    evidence.truncate(5);
    grounding.truncate(3);

    (evidence, grounding, animation)
}

/// Validate an exercise choice and update the user's progress.
pub fn validate_choice(
    progress_store: &mut ProgressStore,
    lesson_id: &str,
    exercise_id: &str,
    choice_index: u32,
) -> Option<ExerciseValidationOutcomeDto> {
    let result = validate_exercise_choice(lesson_id, exercise_id, choice_index as usize)?;
    progress_store.record_result(lesson_id, result.is_correct);
    let p = progress_store.get(lesson_id);
    let status_str = match p.status {
        netpulse_learn::LessonStatus::NotStarted => "not_started",
        netpulse_learn::LessonStatus::InProgress => "in_progress",
        netpulse_learn::LessonStatus::Completed => "completed",
        netpulse_learn::LessonStatus::Mastered => "mastered",
        _ => "not_started",
    };

    Some(ExerciseValidationOutcomeDto {
        is_correct: result.is_correct,
        feedback: result.feedback,
        explanation: result.explanation,
        correct_choice_index: result.correct_choice_index as u32,
        new_mastery: p.mastery,
        status: status_str.to_string(),
    })
}

/// Browse the whole protocol reference, with real "your examples" availability
/// wired in from the learner's flows.
pub fn explorer_browse(store: &CaptureStore) -> Vec<ExplorerEntryDto> {
    entries_with_examples(store, browse())
}

/// Search the protocol reference by term/symptom, with real "your
/// examples" availability wired in.
pub fn explorer_search(store: &CaptureStore, term: &str) -> Vec<ExplorerEntryDto> {
    entries_with_examples(store, search(term))
}

/// Project explorer entries to wire DTOs, marking `examples_available` only when
/// a matching flow actually exists in the store — the reference↔
/// reality wiring, never a guess.
fn entries_with_examples(
    store: &CaptureStore,
    entries: Vec<ExplorerEntry>,
) -> Vec<ExplorerEntryDto> {
    let all_flows: Vec<Flow> = store
        .flows_in_window(0, u64::MAX)
        .into_iter()
        .cloned()
        .collect();
    entries
        .into_iter()
        .map(|mut entry| {
            entry.examples_available =
                !examples_for(ExplanationKey(entry.key), &all_flows).is_empty();
            project::explorer_entry_dto(&entry)
        })
        .collect()
}

/// Build the data-driven handshake animation model for one flow,
/// projected to its wire DTO. `None` when the flow is unknown or its RTT was
/// never observable (we never fabricate a timing).
pub fn handshake_animation_for_flow(
    store: &CaptureStore,
    flow_id: u64,
) -> Option<AnimationModelDto> {
    let flow = store.flow(flow_id)?;
    let rtt = flow.stats.rtt_estimate_nanos?;
    let model = tcp_handshake(rtt);
    Some(project::animation_model_dto(&model))
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_core::net::{FiveTuple, L4Proto, L7Proto};
    use netpulse_core::{FlowMetrics, FlowState, ProtoEventKind, Timestamp};
    use netpulse_storage::PayloadPolicy;
    use std::net::{IpAddr, Ipv4Addr};

    fn ip(a: u8, b: u8, c: u8, d: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(a, b, c, d))
    }

    fn seeded_store() -> CaptureStore {
        let mut store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        let flow = Flow {
            id: 10,
            key: FiveTuple::new(
                ip(192, 168, 0, 1),
                50000,
                ip(93, 184, 216, 34),
                443,
                L4Proto::Tcp,
            ),
            first_ts: Timestamp::new(1_000, 1_000),
            last_ts: Timestamp::new(2_000, 2_000),
            l4: L4Proto::Tcp,
            l7: L7Proto::Tls,
            stats: FlowMetrics {
                bytes: 4096,
                packets: 8,
                rtt_estimate_nanos: Some(30_000_000),
                retransmits: 0,
                loss_indicators: 0,
            },
            state: FlowState::Closed,
        };
        let events = vec![
            ProtoEvent {
                flow_id: 10,
                ts: Timestamp::new(1_000, 1_000),
                kind: ProtoEventKind::DnsResponse,
            },
            ProtoEvent {
                flow_id: 10,
                ts: Timestamp::new(1_100, 1_100),
                kind: ProtoEventKind::TlsClientHello,
            },
        ];
        store.insert_flow(flow, events);
        store.insert_session(Session {
            id: 1,
            process_id: 0,
            start_ts: Timestamp::new(1_000, 1_000),
            trigger: "resolved and connected to example.com".into(),
            flow_ids: vec![10],
        });
        store
    }

    #[test]
    fn education_view_offers_grounded_lessons_and_a_journey() {
        let store = seeded_store();
        let view = present_education(&store, Depth::Beginner);

        // The TLS handshake becomes a grounded encryption lesson citing evidence.
        let tls = view
            .offers
            .iter()
            .find(|o| o.lesson_id == "b5.encryption")
            .expect("encryption lesson offered");
        assert!(tls.grounded);
        assert!(!tls.evidence.is_empty());
        assert!(tls.grounding.iter().any(|g| g.contains("example.com")));

        // One journey for the one session, with staged narration.
        assert_eq!(view.journeys.len(), 1);
        assert!(!view.journeys[0].stages.is_empty());

        // The reference marks TLS as having a real example (bidirectional link).
        let tls_entry = view
            .reference
            .iter()
            .find(|e| e.key == "tls.sni")
            .expect("tls.sni entry");
        assert!(tls_entry.examples_available, "the user has a TLS flow");
        // A key with no matching flow is honestly marked unavailable.
        let udp_entry = view.reference.iter().find(|e| e.key == "udp.port").unwrap();
        assert!(!udp_entry.examples_available);
    }

    #[test]
    fn beginner_journey_hides_timings_expert_shows_them() {
        let store = seeded_store();
        let beginner = present_education(&store, Depth::Beginner);
        let expert = present_education(&store, Depth::Expert);
        let b_details = beginner.journeys[0]
            .stages
            .iter()
            .filter(|s| s.detail.is_some())
            .count();
        let e_details = expert.journeys[0]
            .stages
            .iter()
            .filter(|s| s.detail.is_some())
            .count();
        assert!(
            e_details > b_details,
            "expert discloses stage timings/detail beginner does not"
        );
    }

    #[test]
    fn handshake_animation_is_grounded_in_measured_rtt() {
        let store = seeded_store();
        let anim = handshake_animation_for_flow(&store, 10).expect("flow has an RTT");
        // The SYN-ACK arrives at the measured RTT — truthful timing.
        let syn_ack = anim.events.iter().find(|e| e.label == "SYN-ACK").unwrap();
        assert_eq!(syn_ack.at_nanos, 30_000_000);
        // The mandatory reduced-motion equivalent ships alongside.
        assert_eq!(anim.reduced_motion.len(), anim.events.len());
        // An unknown flow yields no fabricated animation.
        assert!(handshake_animation_for_flow(&store, 999).is_none());
    }
}
