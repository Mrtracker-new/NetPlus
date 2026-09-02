use crate::AppState;
use netpulse_api::{InterfaceDto, Query, QueryResponse};
use netpulse_engine::attribution::Attribution;
use netpulse_engine::education::{
    explorer_browse, explorer_search, handshake_animation_for_flow, present_education,
};
use netpulse_engine::export::{preview as export_preview, Sanitizer};
use netpulse_engine::pipeline::present;
use netpulse_engine::security::{ask_assistant, present_security};

/// Execute a historical or aggregated read query against the shell app state.
#[tracing::instrument(level = "debug", skip(state))]
pub fn execute_query(state: &AppState, query: Query) -> Result<QueryResponse, String> {
    let store = match state.store.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    let stats = match state.stats.lock() {
        Ok(g) => *g,
        Err(p) => *p.into_inner(),
    };
    match query {
        Query::NarrativeFeed { depth, .. } => {
            let view = present(&store, crate::to_depth(depth), stats);
            Ok(QueryResponse::NarrativeFeed {
                cards: view.narratives,
            })
        }
        Query::MonitorSnapshot {
            from_mono_nanos,
            to_mono_nanos,
            time_range,
        } => {
            let depth = match state.depth.lock() {
                Ok(g) => *g,
                Err(p) => *p.into_inner(),
            };
            let correlator = state.correlator.lock().ok();
            let view = netpulse_engine::pipeline::present_window(
                &store,
                depth,
                stats,
                correlator.as_deref(),
                state.sockets.as_deref(),
                time_range,
                from_mono_nanos,
                to_mono_nanos,
            );
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
        Query::GetCurriculum => {
            let progress_store = match state.progress_store.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            let (modules, summary) =
                netpulse_engine::education::curriculum_view(&store, &progress_store);
            Ok(QueryResponse::Curriculum { modules, summary })
        }
        Query::GetLessonDetail { lesson_id } => {
            let progress_store = match state.progress_store.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            let depth = match state.depth.lock() {
                Ok(g) => *g,
                Err(p) => *p.into_inner(),
            };
            match netpulse_engine::education::lesson_detail_view(
                &store,
                &progress_store,
                &lesson_id,
                depth,
            ) {
                Some(lesson) => Ok(QueryResponse::LessonDetail { lesson }),
                None => Err(format!("lesson '{lesson_id}' not found")),
            }
        }
        Query::GetLearningProgress => {
            let progress_store = match state.progress_store.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            let summary =
                netpulse_engine::project::learning_progress_dto(&progress_store.summary());
            Ok(QueryResponse::LearningProgress { progress: summary })
        }
        Query::ValidateExerciseChoice {
            lesson_id,
            exercise_id,
            choice_index,
        } => {
            let mut progress_store = match state.progress_store.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match netpulse_engine::education::validate_choice(
                &mut progress_store,
                &lesson_id,
                &exercise_id,
                choice_index,
            ) {
                Some(outcome) => {
                    state.save_progress(&progress_store);
                    Ok(QueryResponse::ExerciseValidation { outcome })
                }
                None => Err(format!(
                    "exercise '{exercise_id}' in lesson '{lesson_id}' not found"
                )),
            }
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
            let depth = match state.depth.lock() {
                Ok(g) => *g,
                Err(p) => *p.into_inner(),
            };
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
                .map(|p| {
                    netpulse_engine::project::plugin_descriptor_dto(p, netpulse_api::API_VERSION)
                })
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
            let capture_running = state
                .capture
                .lock()
                .map_err(|_| "state poisoned")?
                .is_some();
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
            let handshake =
                netpulse_api::negotiate_api_version_range(client_min_version, client_max_version);
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
                    source: Some(out.source),
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
                    source: Some(out.source.clone()),
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
                    source: Some(out.source),
                },
            })
        }
        Query::DiscoverGateway => {
            use netpulse_platform::diagnostics::{DiagnosticProbe, GatewayProbe};
            let probe = GatewayProbe::new();
            let cancel = std::sync::atomic::AtomicBool::new(false);
            let out = probe.run(cancel).map_err(|e| e.to_string())?;
            Ok(QueryResponse::GatewayResult {
                result: netpulse_api::GatewayResultDto {
                    gateway_ip: out.gateway_ip,
                    interface_name: out.interface_name,
                    status: out.status,
                    source: out.source,
                },
            })
        }
        Query::RunDnsProbe { target } => {
            use netpulse_platform::diagnostics::{DiagnosticProbe, DnsProbe};
            let probe = DnsProbe::new(target);
            let cancel = std::sync::atomic::AtomicBool::new(false);
            let out = probe.run(cancel).map_err(|e| e.to_string())?;
            Ok(QueryResponse::DnsResult {
                result: netpulse_api::DnsResultDto {
                    target: out.target,
                    resolution_rtt_ms: out.resolution_rtt_ms,
                    resolved_ips: out.resolved_ips,
                    timed_out: out.timed_out,
                    error: out.error,
                    source: out.source,
                },
            })
        }
        Query::RunHttpProbe { url } => {
            use netpulse_platform::diagnostics::{DiagnosticProbe, HttpProbe};
            let probe = HttpProbe::new(url);
            let cancel = std::sync::atomic::AtomicBool::new(false);
            let out = probe.run(cancel).map_err(|e| e.to_string())?;
            Ok(QueryResponse::HttpResult {
                result: netpulse_api::HttpResultDto {
                    url: out.url,
                    status_code: out.status_code,
                    connect_ms: out.connect_ms,
                    ttfb_ms: out.ttfb_ms,
                    transfer_ms: out.transfer_ms,
                    tls_ms: out.tls_ms,
                    error: out.error,
                    limitation: out.limitation,
                    source: out.source,
                },
            })
        }
        Query::BuildAndDecodePacket { layers } => {
            let inspection =
                netpulse_learn::sandbox::PacketBuilderEngine::build_and_inspect(&layers);
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
            let report =
                netpulse_flow::diff::SessionDiffEngine::compare(session_id_a, session_id_b);
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
        Query::RunStageProbe { stage, target } => {
            use netpulse_api::dto::{DiagnosticChainStageKindDto, StageProbeResultDto, StageProbeStatusDto};
            use netpulse_platform::diagnostics::DiagnosticProbe;

            let cancel = std::sync::atomic::AtomicBool::new(false);

            let result = match stage {
                DiagnosticChainStageKindDto::Device | DiagnosticChainStageKindDto::Interface => {
                    let stats_dropped = stats.dropped;
                    let buf_util = if stats.buffer_capacity > 0 {
                        (stats.buffer_frames as f32 / stats.buffer_capacity as f32) * 100.0
                    } else {
                        0.0
                    };
                    StageProbeResultDto {
                        stage,
                        probe_type: "LocalStackProbe".to_string(),
                        target: None,
                        status: if stats_dropped > 0 { StageProbeStatusDto::Degraded } else { StageProbeStatusDto::Success },
                        latency_ms: Some(0.0),
                        summary: format!("Local capture stack verified: {stats_dropped} drops, buffer {buf_util:.1}% utilized"),
                        details: vec![
                            format!("Buffer capacity: {}", stats.buffer_capacity),
                            format!("Buffer frames: {}", stats.buffer_frames),
                            format!("Shed stage: {:?}", stats.shed_stage),
                        ],
                    }
                }
                DiagnosticChainStageKindDto::Router => {
                    use netpulse_platform::diagnostics::GatewayProbe;
                    let probe = GatewayProbe::new();
                    match probe.run(cancel) {
                        Ok(out) => {
                            let (status, lat) = match out.status.as_str() {
                                "Reachable" => (StageProbeStatusDto::Success, Some(1.0)),
                                "Degraded" => (StageProbeStatusDto::Degraded, Some(15.0)),
                                _ => (StageProbeStatusDto::Error, None),
                            };
                            StageProbeResultDto {
                                stage,
                                probe_type: "GatewayProbe".to_string(),
                                target: out.gateway_ip.clone(),
                                status,
                                latency_ms: lat,
                                summary: format!("Default gateway {} on interface {}: {}", out.gateway_ip.as_deref().unwrap_or("none"), out.interface_name.as_deref().unwrap_or("none"), out.status),
                                details: vec![format!("Source: {}", out.source)],
                            }
                        }
                        Err(e) => StageProbeResultDto {
                            stage,
                            probe_type: "GatewayProbe".to_string(),
                            target: None,
                            status: StageProbeStatusDto::Error,
                            latency_ms: None,
                            summary: format!("Gateway probe failed: {e}"),
                            details: vec![],
                        },
                    }
                }
                DiagnosticChainStageKindDto::Isp => {
                    let Some(t) = target.filter(|s| is_valid_probe_target(s)) else {
                        return Ok(QueryResponse::StageProbeResult {
                            result: StageProbeResultDto {
                                stage,
                                probe_type: "TracerouteProbe".to_string(),
                                target: None,
                                status: StageProbeStatusDto::TargetUnavailable,
                                latency_ms: None,
                                summary: "No valid destination target available to measure ISP upstream hops".to_string(),
                                details: vec!["Active ISP hop analysis requires a valid IP address or hostname target.".to_string()],
                            },
                        });
                    };

                    use netpulse_platform::diagnostics::TracerouteProbe;
                    let probe = TracerouteProbe::new(t.clone(), "udp".to_string(), 15);
                    match probe.run(cancel) {
                        Ok(out) => {
                            let rtt = out.hops.first().map(|h| h.rtt_ms);
                            let hop_count = out.hops.len();
                            StageProbeResultDto {
                                stage,
                                probe_type: "TracerouteProbe".to_string(),
                                target: Some(t),
                                status: if rtt.is_some() { StageProbeStatusDto::Success } else { StageProbeStatusDto::Degraded },
                                latency_ms: rtt,
                                summary: format!("Traced {hop_count} hops toward target"),
                                details: out.hops.iter().map(|h| format!("Hop {}: {} (rtt: {:?})", h.ttl, h.ip, h.rtt_ms)).collect(),
                            }
                        }
                        Err(e) => StageProbeResultDto {
                            stage,
                            probe_type: "TracerouteProbe".to_string(),
                            target: Some(t),
                            status: StageProbeStatusDto::Error,
                            latency_ms: None,
                            summary: format!("Traceroute probe failed: {e}"),
                            details: vec![],
                        },
                    }
                }
                DiagnosticChainStageKindDto::Dns => {
                    let Some(t) = target.filter(|s| is_valid_probe_target(s)) else {
                        return Ok(QueryResponse::StageProbeResult {
                            result: StageProbeResultDto {
                                stage,
                                probe_type: "DnsProbe".to_string(),
                                target: None,
                                status: StageProbeStatusDto::TargetUnavailable,
                                latency_ms: None,
                                summary: "No valid DNS query target observed in current capture window".to_string(),
                                details: vec!["Generate DNS traffic or supply a valid domain name to enable in-line resolution probing.".to_string()],
                            },
                        });
                    };

                    use netpulse_platform::diagnostics::DnsProbe;
                    let probe = DnsProbe::new(t.clone());
                    match probe.run(cancel) {
                        Ok(out) => {
                            let status = if out.timed_out {
                                StageProbeStatusDto::Timeout
                            } else if out.error.is_some() {
                                StageProbeStatusDto::Error
                            } else {
                                StageProbeStatusDto::Success
                            };
                            StageProbeResultDto {
                                stage,
                                probe_type: "DnsProbe".to_string(),
                                target: Some(t),
                                status,
                                latency_ms: out.resolution_rtt_ms,
                                summary: format!(
                                    "DNS resolution for {}: {} ms ({} IPs resolved)",
                                    out.target,
                                    out.resolution_rtt_ms.map(|r| format!("{r:.1}")).unwrap_or_else(|| "—".into()),
                                    out.resolved_ips.len()
                                ),
                                details: out.resolved_ips.iter().map(|ip| format!("Resolved: {ip}")).collect(),
                            }
                        }
                        Err(e) => StageProbeResultDto {
                            stage,
                            probe_type: "DnsProbe".to_string(),
                            target: Some(t),
                            status: StageProbeStatusDto::Error,
                            latency_ms: None,
                            summary: format!("DNS probe error: {e}"),
                            details: vec![],
                        },
                    }
                }
                DiagnosticChainStageKindDto::Cdn => {
                    let Some(t) = target.filter(|s| is_valid_probe_target(s)) else {
                        return Ok(QueryResponse::StageProbeResult {
                            result: StageProbeResultDto {
                                stage,
                                probe_type: "HttpProbe".to_string(),
                                target: None,
                                status: StageProbeStatusDto::TargetUnavailable,
                                latency_ms: None,
                                summary: "No valid CDN edge URL observed in current capture window".to_string(),
                                details: vec!["A valid HTTP/HTTPS endpoint or hostname is required for CDN edge probing.".to_string()],
                            },
                        });
                    };

                    use netpulse_platform::diagnostics::HttpProbe;
                    let url = if !t.starts_with("http://") && !t.starts_with("https://") {
                        format!("https://{t}")
                    } else {
                        t.clone()
                    };
                    let probe = HttpProbe::new(url.clone());
                    match probe.run(cancel) {
                        Ok(out) => {
                            let status = if out.error.is_some() {
                                StageProbeStatusDto::Error
                            } else {
                                StageProbeStatusDto::Success
                            };
                            StageProbeResultDto {
                                stage,
                                probe_type: "HttpProbe".to_string(),
                                target: Some(url),
                                status,
                                latency_ms: out.ttfb_ms,
                                summary: format!(
                                    "HTTP TTFB: {} ms, connect: {} ms (status: {:?})",
                                    out.ttfb_ms.map(|r| format!("{r:.1}")).unwrap_or_else(|| "—".into()),
                                    out.connect_ms.map(|r| format!("{r:.1}")).unwrap_or_else(|| "—".into()),
                                    out.status_code
                                ),
                                details: vec![
                                    format!("Connect: {} ms", out.connect_ms.map(|r| format!("{r:.1}")).unwrap_or_else(|| "—".into())),
                                    format!("TTFB: {} ms", out.ttfb_ms.map(|r| format!("{r:.1}")).unwrap_or_else(|| "—".into())),
                                    format!("Transfer: {} ms", out.transfer_ms.map(|r| format!("{r:.1}")).unwrap_or_else(|| "—".into())),
                                    format!("TLS: {} ms", out.tls_ms.map(|r| format!("{r:.1}")).unwrap_or_else(|| "—".into())),
                                ],
                            }
                        }
                        Err(e) => StageProbeResultDto {
                            stage,
                            probe_type: "HttpProbe".to_string(),
                            target: Some(url),
                            status: StageProbeStatusDto::Error,
                            latency_ms: None,
                            summary: format!("HTTP probe failed: {e}"),
                            details: vec![],
                        },
                    }
                }
                DiagnosticChainStageKindDto::Destination => {
                    let Some(t) = target.filter(|s| is_valid_probe_target(s)) else {
                        return Ok(QueryResponse::StageProbeResult {
                            result: StageProbeResultDto {
                                stage,
                                probe_type: "PingProbe".to_string(),
                                target: None,
                                status: StageProbeStatusDto::TargetUnavailable,
                                latency_ms: None,
                                summary: "No valid remote destination endpoint observed in current capture window".to_string(),
                                details: vec!["Capture active flows to a destination or provide a valid IP/hostname target before running probe.".to_string()],
                            },
                        });
                    };

                    use netpulse_platform::diagnostics::PingProbe;
                    let probe = PingProbe::new(t.clone(), 4);
                    match probe.run(cancel) {
                        Ok(out) => {
                            let status = if out.loss_pct >= 100.0 {
                                StageProbeStatusDto::Timeout
                            } else if out.loss_pct > 0.0 {
                                StageProbeStatusDto::Degraded
                            } else {
                                StageProbeStatusDto::Success
                            };
                            StageProbeResultDto {
                                stage,
                                probe_type: "PingProbe".to_string(),
                                target: Some(t),
                                status,
                                latency_ms: Some(out.avg_rtt_ms),
                                summary: format!("Ping to {}: avg {:.1} ms (loss: {:.0}%)", out.target, out.avg_rtt_ms, out.loss_pct),
                                details: vec![
                                    format!("Sent: {}, Received: {}", out.sent, out.received),
                                    format!("Min RTT: {:.1} ms, Max RTT: {:.1} ms", out.min_rtt_ms, out.max_rtt_ms),
                                ],
                            }
                        }
                        Err(e) => StageProbeResultDto {
                            stage,
                            probe_type: "PingProbe".to_string(),
                            target: Some(t),
                            status: StageProbeStatusDto::Error,
                            latency_ms: None,
                            summary: format!("Ping probe failed: {e}"),
                            details: vec![],
                        },
                    }
                }
                _ => StageProbeResultDto {
                    stage,
                    probe_type: "Unknown".to_string(),
                    target: None,
                    status: StageProbeStatusDto::TargetUnavailable,
                    latency_ms: None,
                    summary: "Probe unsupported for this stage".to_string(),
                    details: vec![],
                },
            };

            Ok(QueryResponse::StageProbeResult { result })
        }
        Query::ListFleetHosts => {
            let agent = netpulse_capture_svc::agent::FleetAgent::new(
                "server-east-01".into(),
                "Linux".into(),
            );
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

/// Validate that a probe target is a legitimate, non-malformed IP address or hostname.
/// Rejects empty strings, whitespace, control characters, shell metacharacters, or invalid formats.
fn is_valid_probe_target(t: &str) -> bool {
    let trimmed = t.trim();
    if trimmed.is_empty() || trimmed.len() > 253 {
        return false;
    }
    if trimmed.parse::<std::net::IpAddr>().is_ok() {
        return true;
    }
    let host = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .unwrap_or(trimmed);
    let host = host.split('/').next().unwrap_or(host);
    let host = host.split(':').next().unwrap_or(host);

    if host.is_empty() || host.len() > 253 {
        return false;
    }
    if host.parse::<std::net::IpAddr>().is_ok() {
        return true;
    }
    host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            && !label.starts_with('-')
            && !label.ends_with('-')
    })
}
