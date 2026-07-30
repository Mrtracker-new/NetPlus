use crate::AppState;
use netpulse_api::{InterfaceDto, Query, QueryResponse};
use netpulse_engine::attribution::Attribution;
use netpulse_engine::education::{
    explorer_browse, explorer_search, handshake_animation_for_flow, present_education,
};
use netpulse_engine::export::{preview as export_preview, Sanitizer};
use netpulse_engine::pipeline::present;
use netpulse_engine::security::{ask_assistant, present_security};

/// Execute a historical or aggregated read query against the shell app state (docs/02 §7.1).
#[tracing::instrument(level = "debug", skip(state))]
pub fn execute_query(state: &AppState, query: Query) -> Result<QueryResponse, String> {
    let store = state.store.lock().map_err(|_| "state poisoned")?;
    let stats = *state.stats.lock().map_err(|_| "state poisoned")?;
    match query {
        Query::NarrativeFeed { depth, .. } => {
            let view = present(&store, crate::to_depth(depth), stats);
            Ok(QueryResponse::NarrativeFeed {
                cards: view.narratives,
            })
        }
        Query::MonitorSnapshot { .. } => {
            let depth = *state.depth.lock().map_err(|_| "state poisoned")?;
            let view = present(&store, depth, stats);
            Ok(QueryResponse::MonitorSnapshot {
                snapshot: view.monitor,
            })
        }
        Query::JourneyOfSession { session_id, depth } => {
            let view = present(&store, crate::to_depth(depth), stats);
            let sentences = view
                .narratives
                .into_iter()
                .find(|c| {
                    c.evidence
                        .iter()
                        .any(|e| matches!(e, netpulse_api::EvidenceRefDto::Session(id) if *id == session_id))
                })
                .map(|c| {
                    let mut s = vec![c.headline];
                    s.extend(c.lines);
                    s
                })
                .unwrap_or_default();
            Ok(QueryResponse::Journey { sentences })
        }
        Query::AttributionOfFlow { flow_id } => {
            let attribution = match store.flow(flow_id) {
                Some(flow) => {
                    let corr = state.correlator.lock().map_err(|_| "state poisoned")?;
                    corr.attribute(&flow.key, flow.first_ts.mono_nanos)
                }
                None => Attribution::unknown(),
            };
            let name = match (attribution.pid, state.sockets.as_ref()) {
                (Some(pid), Some(source)) => {
                    source.process_info(pid).ok().flatten().map(|p| p.name)
                }
                _ => None,
            };
            Ok(QueryResponse::Attribution {
                attribution: netpulse_engine::project::attribution_dto(&attribution, name),
            })
        }
        Query::PacketsOfFlow { .. } => Ok(QueryResponse::PayloadsUnavailable),
        Query::LessonOffers { session_id, depth } => {
            let view = present_education(&store, crate::to_depth(depth));
            let offers = view
                .offers
                .into_iter()
                .filter(|o| {
                    o.evidence.iter().any(|e| {
                        matches!(e, netpulse_api::EvidenceRefDto::Session(id) if *id == session_id)
                    })
                })
                .collect();
            Ok(QueryResponse::LessonOffers { offers })
        }
        Query::JourneyStagesOfSession { session_id, depth } => {
            let view = present_education(&store, crate::to_depth(depth));
            let journey = view
                .journeys
                .into_iter()
                .find(|j| j.session_id == session_id)
                .unwrap_or(netpulse_api::PageJourneyDto {
                    session_id,
                    stages: Vec::new(),
                    fanout: Vec::new(),
                });
            Ok(QueryResponse::PageJourney { journey })
        }
        Query::ExplorerBrowse => Ok(QueryResponse::ExplorerEntries {
            entries: explorer_browse(&store),
        }),
        Query::ExplorerSearch { term } => Ok(QueryResponse::ExplorerEntries {
            entries: explorer_search(&store, &term),
        }),
        Query::HandshakeAnimationForFlow { flow_id } => {
            match handshake_animation_for_flow(&store, flow_id) {
                Some(animation) => Ok(QueryResponse::Animation { animation }),
                None => Ok(QueryResponse::PayloadsUnavailable),
            }
        }
        Query::SecurityFindings {
            from_mono_nanos,
            to_mono_nanos,
        } => {
            let depth = *state.depth.lock().map_err(|_| "state poisoned")?;
            Ok(QueryResponse::Findings {
                findings: present_security(&store, from_mono_nanos, to_mono_nanos, depth),
            })
        }
        Query::AskAssistant { question } => Ok(QueryResponse::AssistantAnswer {
            answer: ask_assistant(&store, &question),
        }),
        Query::ListRecordings => {
            let recordings = state.recordings.lock().map_err(|_| "state poisoned")?;
            let summaries = recordings
                .iter()
                .enumerate()
                .map(|(i, r)| netpulse_engine::project::recording_summary_dto(i as u64, r, false))
                .collect();
            Ok(QueryResponse::Recordings {
                recordings: summaries,
            })
        }
        Query::ReplayState => {
            let replay = state.replay.lock().map_err(|_| "state poisoned")?;
            let s = replay
                .as_ref()
                .map(|c| c.state())
                .unwrap_or_else(crate::empty_replay_state);
            Ok(QueryResponse::ReplayState {
                state: netpulse_engine::project::replay_state_dto(&s),
            })
        }
        Query::ExportPreview { selection, format } => {
            let preview = export_preview(
                &store,
                &crate::to_selection(selection),
                crate::to_format(format),
                &Sanitizer::default(),
            );
            Ok(QueryResponse::ExportPreview {
                preview: netpulse_engine::project::export_preview_dto(&preview),
            })
        }
        Query::ListPlugins => {
            let registry = state.registry.lock().map_err(|_| "state poisoned")?;
            let descriptors = registry
                .plugins()
                .iter()
                .map(|p| netpulse_engine::project::plugin_descriptor_dto(p, netpulse_api::API_VERSION))
                .collect();
            Ok(QueryResponse::Plugins {
                plugins: descriptors,
            })
        }
        Query::Interfaces => {
            let interfaces = netpulse_platform::list_interfaces()
                .map(|list| {
                    list.into_iter()
                        .map(|i| InterfaceDto {
                            id: i.id,
                            name: i.name,
                            description: i.description,
                        })
                        .collect()
                })
                .unwrap_or_default();
            Ok(QueryResponse::Interfaces { interfaces })
        }
        Query::HealthCheck => {
            let capture_running = state.capture.lock().map_err(|_| "state poisoned")?.is_some();
            let flow_count = store.flow_count();
            let session_count = store.session_count();
            let check = netpulse_api::ComponentCheckDto {
                component: "storage".into(),
                status: "healthy".into(),
                message: None,
            };
            let status = netpulse_api::HealthStatusDto {
                schema_version: 1,
                status: "healthy".into(),
                uptime_secs: 0,
                capture_running,
                active_flows: flow_count,
                active_sessions: session_count,
                store_records: (flow_count + session_count) as u64,
                checks: vec![check],
                version: "0.1.0".into(),
                api_version: netpulse_api::API_VERSION,
            };
            Ok(QueryResponse::Health { status })
        }
        Query::Handshake {
            client_min_version,
            client_max_version,
        } => {
            let handshake = netpulse_api::negotiate_api_version_range(
                client_min_version,
                client_max_version,
            );
            Ok(QueryResponse::Handshake { handshake })
        }
        Query::GetCapabilityRegistry => {
            let reg = netpulse_core::capabilities::CapabilityRegistry::default();
            let json = serde_json::to_value(reg).unwrap_or(serde_json::Value::Null);
            Ok(QueryResponse::CapabilityRegistry { registry: json })
        }
        Query::RunPing { target, count } => {
            use netpulse_platform::diagnostics::{DiagnosticProbe, PingProbe};
            let probe = PingProbe::new(target, count);
            let cancel = std::sync::atomic::AtomicBool::new(false);
            let out = probe.run(cancel).map_err(|e| e.to_string())?;
            Ok(QueryResponse::PingResult {
                result: netpulse_api::PingResultDto {
                    target: out.target,
                    sent: out.sent,
                    received: out.received,
                    loss_pct: out.loss_pct,
                    min_rtt_ms: out.min_rtt_ms,
                    avg_rtt_ms: out.avg_rtt_ms,
                    max_rtt_ms: out.max_rtt_ms,
                    stddev_rtt_ms: out.stddev_rtt_ms,
                },
            })
        }
        Query::RunTraceroute {
            target,
            transport,
            max_hops,
        } => {
            use netpulse_platform::diagnostics::{DiagnosticProbe, TracerouteProbe};
            let probe = TracerouteProbe::new(target, transport, max_hops);
            let cancel = std::sync::atomic::AtomicBool::new(false);
            let out = probe.run(cancel).map_err(|e| e.to_string())?;
            let hops = out
                .hops
                .into_iter()
                .map(|h| netpulse_api::TracerouteHopDto {
                    ttl: h.ttl,
                    ip: h.ip,
                    hostname: h.hostname,
                    rtt_ms: h.rtt_ms,
                    status: h.status,
                })
                .collect();
            Ok(QueryResponse::TracerouteResult { hops })
        }
        Query::RunBufferbloatTest { target } => {
            use netpulse_platform::diagnostics::{BufferbloatProbe, DiagnosticProbe};
            let probe = BufferbloatProbe::new(target);
            let cancel = std::sync::atomic::AtomicBool::new(false);
            let out = probe.run(cancel).map_err(|e| e.to_string())?;
            Ok(QueryResponse::BufferbloatResult {
                result: netpulse_api::BufferbloatResultDto {
                    target: out.target,
                    idle_rtt_ms: out.idle_rtt_ms,
                    loaded_rtt_ms: out.loaded_rtt_ms,
                    delta_rtt_ms: out.delta_rtt_ms,
                    grade: out.grade,
                },
            })
        }
        Query::BuildAndDecodePacket { layers } => {
            let inspection = netpulse_learn::sandbox::PacketBuilderEngine::build_and_inspect(&layers);
            Ok(QueryResponse::DecodedPacketInspection {
                inspection: netpulse_api::PacketInspectionDto {
                    raw_hex: inspection.raw_hex,
                    layers: inspection.layers,
                    diagnostics: inspection
                        .diagnostics
                        .into_iter()
                        .map(|d| netpulse_api::FieldDiagnosticDto {
                            severity: d.severity,
                            field: d.field,
                            rfc_reference: d.rfc_reference,
                            explanation: d.explanation,
                        })
                        .collect(),
                },
            })
        }
        Query::CompareSessions {
            session_id_a,
            session_id_b,
        } => {
            let report = netpulse_flow::diff::SessionDiffEngine::compare(session_id_a, session_id_b);
            Ok(QueryResponse::SessionDiff {
                diff: netpulse_api::SessionDiffDto {
                    session_id_a: report.session_id_a,
                    session_id_b: report.session_id_b,
                    rtt_delta_ms: report.rtt_delta_ms,
                    ttfb_delta_ms: report.ttfb_delta_ms,
                    protocol_shift: report.protocol_shift,
                    semantic_explanation: report.semantic_explanation,
                    confidence: report.confidence,
                    evidence: report.evidence,
                },
            })
        }
        Query::ListFleetHosts => {
            let agent = netpulse_capture_svc::agent::FleetAgent::new("server-east-01".into(), "Linux".into());
            Ok(QueryResponse::FleetHosts {
                hosts: vec![netpulse_api::HostIdentityDto {
                    host_id: agent.identity.host_id,
                    hostname: agent.identity.hostname,
                    friendly_name: agent.identity.friendly_name,
                    os: agent.identity.os,
                    platform: agent.identity.platform,
                    agent_version: agent.identity.agent_version,
                    status: agent.health.status,
                }],
            })
        }
        _ => Ok(QueryResponse::PayloadsUnavailable),
    }
}
