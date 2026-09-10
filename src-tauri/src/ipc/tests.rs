use super::test_support::seeded_state;
use super::{execute_command, execute_query};
use netpulse_api::{
    handshake_codes, handshake_error_codes, Command, ExportFormatDto, ExportSelectionDto,
    PluginCapabilityDto, PluginTrustDto, PluginTypeDto, ProjectionDepth, Query, QueryResponse,
};

#[test]
fn test_seeded_state_is_deterministic() {
    let a = seeded_state();
    let b = seeded_state();

    let reg_a = a.registry.lock().unwrap();
    let reg_b = b.registry.lock().unwrap();

    assert_eq!(reg_a.plugins().len(), reg_b.plugins().len());
    for (pa, pb) in reg_a.plugins().iter().zip(reg_b.plugins().iter()) {
        assert_eq!(pa.manifest.metadata.name, pb.manifest.metadata.name);
        assert_eq!(pa.enabled, pb.enabled);
        assert_eq!(pa.effective_trust, pb.effective_trust);
    }

    assert_eq!(*a.depth.lock().unwrap(), *b.depth.lock().unwrap());
    assert_eq!(
        a.recordings.lock().unwrap().len(),
        b.recordings.lock().unwrap().len()
    );
}

#[test]
fn test_query_handshake_exhaustive_negotiation() {
    let state = seeded_state();

    // 1. Exact current version
    let res = execute_query(
        &state,
        Query::Handshake {
            client_min_version: 6,
            client_max_version: 6,
        },
    )
    .unwrap();
    if let QueryResponse::Handshake { handshake } = res {
        assert!(handshake.compatible);
        assert_eq!(handshake.negotiated_version, Some(6));
        assert_eq!(handshake.host_version, 6);
        assert_eq!(handshake.min_supported_version, 5);
        assert_eq!(handshake.warning_code, None);
        assert_eq!(handshake.error_code, None);
    } else {
        panic!("expected Handshake response");
    }

    // 2. v-1 backward compatibility
    let res_v5 = execute_query(
        &state,
        Query::Handshake {
            client_min_version: 5,
            client_max_version: 5,
        },
    )
    .unwrap();
    if let QueryResponse::Handshake { handshake } = res_v5 {
        assert!(handshake.compatible);
        assert_eq!(handshake.negotiated_version, Some(5));
        assert_eq!(
            handshake.warning_code,
            Some(handshake_codes::DEPRECATED_API_VERSION.into())
        );
        assert_eq!(handshake.error_code, None);
    } else {
        panic!("expected Handshake response");
    }

    // 3. Range intersection [4, 6] -> negotiates 6
    let res_range = execute_query(
        &state,
        Query::Handshake {
            client_min_version: 4,
            client_max_version: 6,
        },
    )
    .unwrap();
    if let QueryResponse::Handshake { handshake } = res_range {
        assert!(handshake.compatible);
        assert_eq!(handshake.negotiated_version, Some(6));
    } else {
        panic!("expected Handshake response");
    }

    // 4. Client too old [1, 4]
    let res_old = execute_query(
        &state,
        Query::Handshake {
            client_min_version: 1,
            client_max_version: 4,
        },
    )
    .unwrap();
    if let QueryResponse::Handshake { handshake } = res_old {
        assert!(!handshake.compatible);
        assert_eq!(handshake.negotiated_version, None);
        assert_eq!(
            handshake.error_code,
            Some(handshake_error_codes::UNSUPPORTED_CLIENT_VERSION_TOO_OLD.into())
        );
    } else {
        panic!("expected Handshake response");
    }

    // 5. Client too new [7, 8]
    let res_new = execute_query(
        &state,
        Query::Handshake {
            client_min_version: 7,
            client_max_version: 8,
        },
    )
    .unwrap();
    if let QueryResponse::Handshake { handshake } = res_new {
        assert!(!handshake.compatible);
        assert_eq!(handshake.negotiated_version, None);
        assert_eq!(
            handshake.error_code,
            Some(handshake_error_codes::UNSUPPORTED_CLIENT_VERSION_TOO_NEW.into())
        );
    } else {
        panic!("expected Handshake response");
    }

    // 6. Invalid range [6, 4]
    let res_invalid = execute_query(
        &state,
        Query::Handshake {
            client_min_version: 6,
            client_max_version: 4,
        },
    )
    .unwrap();
    if let QueryResponse::Handshake { handshake } = res_invalid {
        assert!(!handshake.compatible);
        assert_eq!(
            handshake.error_code,
            Some(handshake_error_codes::INVALID_VERSION_RANGE.into())
        );
    } else {
        panic!("expected Handshake response");
    }
}

#[test]
fn test_query_health_check_invariants() {
    let state = seeded_state();
    let res = execute_query(&state, Query::HealthCheck).unwrap();
    if let QueryResponse::Health { status } = res {
        assert_eq!(status.status, "healthy");
        assert_eq!(status.schema_version, 1);
        assert_eq!(status.api_version, netpulse_api::API_VERSION);
        assert!(!status.capture_running);
        assert_eq!(status.checks.len(), 1);
        assert_eq!(status.checks[0].component, "storage");
    } else {
        panic!("expected Health response");
    }
}

#[test]
fn test_query_list_plugins_invariants() {
    let state = seeded_state();
    let res = execute_query(&state, Query::ListPlugins).unwrap();
    if let QueryResponse::Plugins { plugins } = res {
        // 1. Reference plugins presence
        let names: Vec<_> = plugins.iter().map(|p| p.name.as_str()).collect();
        assert!(names.contains(&"example-dissector"));
        assert!(names.contains(&"example-detector"));
        assert!(names.contains(&"example-enrichment"));
        assert!(names.contains(&"example-export"));
        assert!(names.contains(&"example-view"));

        // 2. Seam-presence invariants across all 5 extension seams
        let types: Vec<_> = plugins.iter().map(|p| p.plugin_type).collect();
        assert!(types.contains(&PluginTypeDto::Dissector));
        assert!(types.contains(&PluginTypeDto::Detector));
        assert!(types.contains(&PluginTypeDto::Enrichment));
        assert!(types.contains(&PluginTypeDto::Export));
        assert!(types.contains(&PluginTypeDto::View));

        // 3. Detailed DTO surface validation for example-view
        let view_plugin = plugins
            .iter()
            .find(|p| p.name == "example-view")
            .expect("example-view should be registered");

        assert_eq!(view_plugin.plugin_type, PluginTypeDto::View);
        assert_eq!(view_plugin.capabilities, vec![PluginCapabilityDto::ApiRead]);
        assert_eq!(view_plugin.trust, PluginTrustDto::FirstParty);
        assert!(view_plugin.enabled);
        assert!(view_plugin.compatible);
        assert_eq!(view_plugin.target_contract, netpulse_api::API_VERSION);
        assert!(view_plugin.config_schema.is_some());

        // Behavioral invariant assertion: ViewPlugin capability is strictly ApiRead
        assert!(!view_plugin
            .capabilities
            .contains(&PluginCapabilityDto::ParseBytes));
        assert!(!view_plugin
            .capabilities
            .contains(&PluginCapabilityDto::EmitFindings));
        assert!(!view_plugin
            .capabilities
            .contains(&PluginCapabilityDto::WriteOutput));

        for p in &plugins {
            assert!(p.compatible);
            assert!(p.enabled);
        }
    } else {
        panic!("expected Plugins response");
    }
}

#[test]
fn test_query_interfaces() {
    let state = seeded_state();
    let res = execute_query(&state, Query::Interfaces).unwrap();
    assert!(matches!(res, QueryResponse::Interfaces { .. }));
}

#[test]
fn test_query_narrative_feed() {
    let state = seeded_state();
    let res = execute_query(
        &state,
        Query::NarrativeFeed {
            from_mono_nanos: Some(0),
            to_mono_nanos: Some(1_000_000),
            depth: ProjectionDepth::Beginner,
        },
    )
    .unwrap();
    assert!(matches!(res, QueryResponse::NarrativeFeed { .. }));

    // Unbounded / server-default query
    let res_unbounded = execute_query(
        &state,
        Query::NarrativeFeed {
            from_mono_nanos: None,
            to_mono_nanos: None,
            depth: ProjectionDepth::Beginner,
        },
    )
    .unwrap();
    assert!(matches!(res_unbounded, QueryResponse::NarrativeFeed { .. }));
}

#[test]
fn test_query_monitor_snapshot() {
    let state = seeded_state();
    let res = execute_query(
        &state,
        Query::MonitorSnapshot {
            from_mono_nanos: None,
            to_mono_nanos: None,
            time_range: Some(netpulse_api::MonitorTimeRangeDto::FiveMinutes),
        },
    )
    .unwrap();
    if let QueryResponse::MonitorSnapshot { snapshot } = res {
        assert_eq!(snapshot.capture_drops, 0);
    } else {
        panic!("expected MonitorSnapshot response");
    }
}

#[test]
fn test_query_journey_of_session() {
    let state = seeded_state();
    let res = execute_query(
        &state,
        Query::JourneyOfSession {
            session_id: 100,
            depth: ProjectionDepth::Beginner,
        },
    )
    .unwrap();
    assert!(matches!(res, QueryResponse::Journey { .. }));
}

#[test]
fn test_query_journey_stages_of_session_and_latency() {
    let state = seeded_state();

    // 1. Non-existent session returns empty stages
    let res = execute_query(
        &state,
        Query::JourneyStagesOfSession {
            session_id: 999,
            depth: ProjectionDepth::Beginner,
        },
    )
    .unwrap();
    if let QueryResponse::PageJourney { journey } = res {
        assert_eq!(journey.session_id, 999);
        assert!(journey.stages.is_empty());
    } else {
        panic!("expected PageJourney response");
    }

    // 2. Populate store with large capture data (200 sessions, 200 flows, 400 events)
    {
        let mut store = state.store.lock().unwrap();
        for s_id in 1..=200 {
            let f_id = s_id * 10;
            let flow = netpulse_core::Flow {
                id: f_id,
                key: netpulse_core::net::FiveTuple::new(
                    std::net::IpAddr::V4(std::net::Ipv4Addr::new(192, 168, 1, 100)),
                    40000 + (s_id as u16),
                    std::net::IpAddr::V4(std::net::Ipv4Addr::new(93, 184, 216, 34)),
                    443,
                    netpulse_core::net::L4Proto::Tcp,
                ),
                first_ts: netpulse_core::Timestamp::new(1000 + s_id, 1000 + s_id),
                last_ts: netpulse_core::Timestamp::new(2000 + s_id, 2000 + s_id),
                l4: netpulse_core::net::L4Proto::Tcp,
                l7: netpulse_core::net::L7Proto::Tls,
                stats: netpulse_core::FlowMetrics {
                    bytes: 1024,
                    packets: 5,
                    rtt_estimate_nanos: Some(25_000_000),
                    retransmits: 0,
                    loss_indicators: 0,
                },
                state: netpulse_core::FlowState::Closed,
            };
            let events = vec![
                netpulse_core::ProtoEvent {
                    flow_id: f_id,
                    ts: netpulse_core::Timestamp::new(1000 + s_id, 1000 + s_id),
                    kind: netpulse_core::ProtoEventKind::DnsResponse,
                },
                netpulse_core::ProtoEvent {
                    flow_id: f_id,
                    ts: netpulse_core::Timestamp::new(1100 + s_id, 1100 + s_id),
                    kind: netpulse_core::ProtoEventKind::TlsClientHello,
                },
            ];
            store.insert_flow(flow, events);
            store.insert_session(netpulse_core::Session {
                id: s_id,
                process_id: 0,
                start_ts: netpulse_core::Timestamp::new(1000 + s_id, 1000 + s_id),
                trigger: format!("resolved and connected to site{s_id}.com"),
                flow_ids: vec![f_id],
            });
        }
    }

    // 3. Querying one session on large capture executes in < 1 ms
    let start = std::time::Instant::now();
    let res = execute_query(
        &state,
        Query::JourneyStagesOfSession {
            session_id: 42,
            depth: ProjectionDepth::Beginner,
        },
    )
    .unwrap();
    let elapsed = start.elapsed();

    if let QueryResponse::PageJourney { journey } = res {
        assert_eq!(journey.session_id, 42);
        assert!(
            !journey.stages.is_empty(),
            "expected stages to be populated"
        );
    } else {
        panic!("expected PageJourney response");
    }

    assert!(
        elapsed < std::time::Duration::from_millis(1),
        "journeyStagesOfSession took {:?}, expected < 1 ms",
        elapsed
    );
}

#[test]
fn test_query_attribution_of_flow() {
    let state = seeded_state();
    let res = execute_query(&state, Query::AttributionOfFlow { flow_id: 1 }).unwrap();
    assert!(matches!(res, QueryResponse::Attribution { .. }));
}

#[test]
fn test_query_lesson_offers() {
    let state = seeded_state();
    let res = execute_query(
        &state,
        Query::LessonOffers {
            session_id: 1,
            depth: ProjectionDepth::Beginner,
        },
    )
    .unwrap();
    assert!(matches!(res, QueryResponse::LessonOffers { .. }));
}

#[test]
fn test_query_explorer_browse_and_search() {
    let state = seeded_state();

    let res_browse = execute_query(&state, Query::ExplorerBrowse).unwrap();
    assert!(matches!(res_browse, QueryResponse::ExplorerEntries { .. }));

    let res_search = execute_query(
        &state,
        Query::ExplorerSearch {
            term: "nonexistent_protocol_xyz_12345".into(),
        },
    )
    .unwrap();
    if let QueryResponse::ExplorerEntries { entries } = res_search {
        assert!(
            entries.is_empty(),
            "nonexistent term should return empty list rather than error"
        );
    } else {
        panic!("expected ExplorerEntries response");
    }
}

#[test]
fn test_query_security_findings() {
    let state = seeded_state();
    let res = execute_query(
        &state,
        Query::SecurityFindings {
            from_mono_nanos: 0,
            to_mono_nanos: 1_000_000,
        },
    )
    .unwrap();
    assert!(matches!(res, QueryResponse::Findings { .. }));
}

#[test]
fn test_query_ask_assistant() {
    let state = seeded_state();
    let res = execute_query(
        &state,
        Query::AskAssistant {
            question: "What protocols are active?".into(),
        },
    )
    .unwrap();
    assert!(matches!(res, QueryResponse::AssistantAnswer { .. }));
}

#[test]
fn test_query_export_preview() {
    let state = seeded_state();
    let res = execute_query(
        &state,
        Query::ExportPreview {
            selection: ExportSelectionDto::Session { id: 1 },
            format: ExportFormatDto::Json,
        },
    )
    .unwrap();
    assert!(matches!(res, QueryResponse::ExportPreview { .. }));
}

#[test]
fn test_command_set_depth_state_transition() {
    let state = seeded_state();

    // Verify initial depth is Beginner
    assert_eq!(*state.depth.lock().unwrap(), netpulse_core::Depth::Beginner);

    // Transition to Expert
    execute_command(
        &state,
        Command::SetDepth {
            depth: ProjectionDepth::Expert,
        },
    )
    .unwrap();
    assert_eq!(*state.depth.lock().unwrap(), netpulse_core::Depth::Expert);

    // Transition to Intermediate
    execute_command(
        &state,
        Command::SetDepth {
            depth: ProjectionDepth::Intermediate,
        },
    )
    .unwrap();
    assert_eq!(
        *state.depth.lock().unwrap(),
        netpulse_core::Depth::Intermediate
    );
}

#[test]
fn test_command_enable_disable_plugin_state_transition() {
    let state = seeded_state();

    // Register an unreviewed plugin (disabled by default)
    let m = netpulse_plugin::PluginManifest {
        manifest_version: 1,
        metadata: netpulse_plugin::PluginMetadata {
            name: "community-plugin".into(),
            plugin_type: netpulse_plugin::PluginType::Detector,
            target_contract: netpulse_plugin::ContractVersion(netpulse_api::API_VERSION),
        },
        config: netpulse_plugin::PluginConfigurationMetadata {
            config_version: 1,
            default_config: serde_json::json!({ "threshold": 5 }),
            config_schema: None,
        },
        security: netpulse_plugin::PluginSecurityMetadata {
            trust: netpulse_plugin::TrustMetadata {
                source: "community".into(),
                signatures: Vec::new(),
                status: netpulse_plugin::TrustStatus::Unreviewed,
            },
            payload_hash: netpulse_plugin::Sha256Digest([0u8; 32]),
            signatures: Vec::new(),
            fuzzed: false,
            has_explanation: false,
        },
    };
    let outcome = netpulse_plugin::VerificationOutcome {
        manifest: m,
        claimed_trust: netpulse_plugin::TrustStatus::Unreviewed,
        effective_trust: netpulse_plugin::TrustStatus::Unreviewed,
        verification_result: Ok(netpulse_plugin::VerificationSuccess::Unreviewed),
        payload_hash_valid: true,
    };

    {
        let mut reg = state.registry.lock().unwrap();
        reg.register(outcome);
    }

    // Verify plugin is registered and disabled
    {
        let reg = state.registry.lock().unwrap();
        let p = reg
            .plugins()
            .iter()
            .find(|p| p.manifest.metadata.name == "community-plugin")
            .unwrap();
        assert!(!p.enabled);
    }

    // Enable plugin -> verify state transition
    execute_command(
        &state,
        Command::EnablePlugin {
            name: "community-plugin".into(),
        },
    )
    .unwrap();
    {
        let reg = state.registry.lock().unwrap();
        let p = reg
            .plugins()
            .iter()
            .find(|p| p.manifest.metadata.name == "community-plugin")
            .unwrap();
        assert!(p.enabled);
    }

    // Disable plugin -> verify state transition
    execute_command(
        &state,
        Command::DisablePlugin {
            name: "community-plugin".into(),
        },
    )
    .unwrap();
    {
        let reg = state.registry.lock().unwrap();
        let p = reg
            .plugins()
            .iter()
            .find(|p| p.manifest.metadata.name == "community-plugin")
            .unwrap();
        assert!(!p.enabled);
    }

    // Test ConfigurePlugin, PatchPluginConfig, and ResetPluginConfig
    execute_command(
        &state,
        Command::ConfigurePlugin {
            name: "community-plugin".into(),
            config: serde_json::json!({ "threshold": 10 }),
        },
    )
    .unwrap();
    {
        let reg = state.registry.lock().unwrap();
        let p = reg
            .plugins()
            .iter()
            .find(|p| p.manifest.metadata.name == "community-plugin")
            .unwrap();
        assert_eq!(p.config["threshold"], 10);
    }

    execute_command(
        &state,
        Command::PatchPluginConfig {
            name: "community-plugin".into(),
            expected_version: Some(1),
            patch: serde_json::json!({ "threshold": 12 }),
        },
    )
    .unwrap();
    {
        let reg = state.registry.lock().unwrap();
        let p = reg
            .plugins()
            .iter()
            .find(|p| p.manifest.metadata.name == "community-plugin")
            .unwrap();
        assert_eq!(p.config["threshold"], 12);
    }

    execute_command(
        &state,
        Command::ResetPluginConfig {
            name: "community-plugin".into(),
        },
    )
    .unwrap();
    {
        let reg = state.registry.lock().unwrap();
        let p = reg
            .plugins()
            .iter()
            .find(|p| p.manifest.metadata.name == "community-plugin")
            .unwrap();
        assert_eq!(p.config["threshold"], 5);
    }
}

#[test]
fn test_command_plugin_idempotency_and_unknown_refusal() {
    let state = seeded_state();

    // Enabling an unknown plugin fails honestly
    let res = execute_command(
        &state,
        Command::EnablePlugin {
            name: "unknown-plugin".into(),
        },
    );
    assert!(res.is_err());
    assert_eq!(res.unwrap_err(), "cannot enable plugin 'unknown-plugin'");

    // Disabling an unknown plugin fails honestly
    let res_dis = execute_command(
        &state,
        Command::DisablePlugin {
            name: "unknown-plugin".into(),
        },
    );
    assert!(res_dis.is_err());
    assert_eq!(res_dis.unwrap_err(), "unknown plugin 'unknown-plugin'");
}

#[test]
fn test_command_stop_capture_idle_refusal() {
    let state = seeded_state();
    let res = execute_command(&state, Command::StopCapture { iface_id: 0 });
    assert!(res.is_err());
    assert_eq!(res.unwrap_err(), "no capture is running");
}

#[test]
fn test_command_start_stop_recording_honest_refusal() {
    let state = seeded_state();

    let res_start = execute_command(&state, Command::StartRecording);
    assert!(res_start.is_err());
    assert!(res_start
        .unwrap_err()
        .contains("recording requires a live capture source"));

    let res_stop = execute_command(&state, Command::StopRecording);
    assert!(res_stop.is_err());
    assert!(res_stop
        .unwrap_err()
        .contains("recording requires a live capture source"));
}

#[test]
fn test_command_replay_transport_refusal_when_unloaded() {
    let state = seeded_state();

    for cmd in [
        Command::ReplayPlay,
        Command::ReplayPause,
        Command::ReplayStep,
        Command::ReplaySeek { mono_nanos: 100 },
        Command::ReplaySetSpeed { percent: 100 },
    ] {
        let res = execute_command(&state, cmd);
        assert!(res.is_err());
        assert_eq!(res.unwrap_err(), "no recording is loaded to replay");
    }
}

#[test]
fn test_command_start_export() {
    let state = seeded_state();
    let res = execute_command(
        &state,
        Command::StartExport {
            selection: ExportSelectionDto::All,
            format: ExportFormatDto::Json,
            level: netpulse_api::PayloadLevelDto::MetadataOnly,
        },
    );
    assert!(res.is_ok());
}

#[test]
fn test_ipc_permission_manifests_parse() {
    use tauri::utils::acl::manifest::PermissionFile;

    let query_json = include_str!("../../permissions/allow-query.json");
    let cmd_json = include_str!("../../permissions/allow-command.json");
    let default_json = include_str!("../../permissions/default.json");

    let query_file: PermissionFile =
        serde_json::from_str(query_json).expect("allow-query.json deserialization");
    let cmd_file: PermissionFile =
        serde_json::from_str(cmd_json).expect("allow-command.json deserialization");
    let default_file: PermissionFile =
        serde_json::from_str(default_json).expect("default.json deserialization");

    assert_eq!(query_file.permission.len(), 1);
    assert_eq!(query_file.permission[0].identifier, "allow-query");
    assert_eq!(query_file.permission[0].commands.allow, vec!["query"]);

    assert_eq!(cmd_file.permission.len(), 1);
    assert_eq!(cmd_file.permission[0].identifier, "allow-command");
    assert_eq!(cmd_file.permission[0].commands.allow, vec!["command"]);

    assert_eq!(default_file.set.len(), 1);
    assert_eq!(default_file.set[0].identifier, "default");
    assert_eq!(
        default_file.set[0].permissions,
        vec!["allow-query", "allow-command"]
    );

    // Verify capabilities default.json references the application default permission set
    let cap_json = include_str!("../../capabilities/default.json");
    let cap_val: serde_json::Value =
        serde_json::from_str(cap_json).expect("capabilities/default.json should be valid JSON");
    let perms = cap_val["permissions"]
        .as_array()
        .expect("permissions array expected");
    assert!(
        perms.iter().any(|p| p.as_str() == Some("default")),
        "capabilities/default.json must explicitly grant application 'default' permission set"
    );
}

#[test]
fn test_curriculum_queries_and_commands_lifecycle() {
    let state = seeded_state();

    // 1. Initial curriculum query
    let cur_res = execute_query(&state, Query::GetCurriculum).unwrap();
    if let QueryResponse::Curriculum { modules, summary } = cur_res {
        assert!(!modules.is_empty());
        assert!(summary.total_lessons >= 5);
        assert_eq!(summary.completed_lessons, 0);
        assert_eq!(summary.overall_mastery_pct, 0);
        assert_eq!(
            summary.next_recommended_lesson_id.as_deref(),
            Some("b1.overview")
        );
    } else {
        panic!("expected Curriculum response");
    }

    // 2. Lesson Detail query
    let detail_res = execute_query(
        &state,
        Query::GetLessonDetail {
            lesson_id: "b4.handshake".into(),
        },
    )
    .unwrap();
    if let QueryResponse::LessonDetail { lesson } = detail_res {
        assert_eq!(lesson.lesson_id, "b4.handshake");
        assert!(!lesson.steps.is_empty());
        assert!(!lesson.exercises.is_empty());
        assert_eq!(lesson.status, "not_started");
    } else {
        panic!("expected LessonDetail response");
    }

    // 3. Start lesson command
    execute_command(
        &state,
        Command::StartLesson {
            lesson_id: "b4.handshake".into(),
        },
    )
    .unwrap();

    let detail_res2 = execute_query(
        &state,
        Query::GetLessonDetail {
            lesson_id: "b4.handshake".into(),
        },
    )
    .unwrap();
    if let QueryResponse::LessonDetail { lesson } = detail_res2 {
        assert_eq!(lesson.status, "in_progress");
    } else {
        panic!("expected LessonDetail response");
    }

    // 4. Submit incorrect exercise choice
    let val_res1 = execute_query(
        &state,
        Query::ValidateExerciseChoice {
            lesson_id: "b4.handshake".into(),
            exercise_id: "tcp.identify.syn".into(),
            choice_index: 1,
        },
    )
    .unwrap();
    if let QueryResponse::ExerciseValidation { outcome } = val_res1 {
        assert!(!outcome.is_correct);
        assert_eq!(outcome.correct_choice_index, 0);
    } else {
        panic!("expected ExerciseValidation response");
    }

    // 5. Submit correct exercise choice
    let val_res2 = execute_query(
        &state,
        Query::ValidateExerciseChoice {
            lesson_id: "b4.handshake".into(),
            exercise_id: "tcp.identify.syn".into(),
            choice_index: 0,
        },
    )
    .unwrap();
    if let QueryResponse::ExerciseValidation { outcome } = val_res2 {
        assert!(outcome.is_correct);
        assert!(outcome.new_mastery > 0.0);
        assert_eq!(outcome.status, "completed");
    } else {
        panic!("expected ExerciseValidation response");
    }

    // 6. Check Explorer entries have layer and RFC metadata
    let exp_res = execute_query(&state, Query::ExplorerBrowse).unwrap();
    if let QueryResponse::ExplorerEntries { entries } = exp_res {
        assert!(!entries.is_empty());
        let syn_entry = entries.iter().find(|e| e.key == "tcp.flags.syn").unwrap();
        assert_eq!(syn_entry.layer, "L4 (Transport)");
        assert!(syn_entry.rfc_references.contains(&9293));
        assert!(syn_entry
            .related_lessons
            .contains(&"b4.handshake".to_string()));
    } else {
        panic!("expected ExplorerEntries response");
    }

    // 7. Reset progress
    execute_command(&state, Command::ResetLearningProgress).unwrap();
    let prog_res = execute_query(&state, Query::GetLearningProgress).unwrap();
    if let QueryResponse::LearningProgress { progress } = prog_res {
        assert_eq!(progress.completed_lessons, 0);
        assert_eq!(progress.overall_mastery_pct, 0);
    } else {
        panic!("expected LearningProgress response");
    }
}

#[test]
fn test_learning_progress_disk_persistence_across_app_restart() {
    let temp_dir = std::env::temp_dir().join(format!(
        "netpulse_test_learn_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = std::fs::create_dir_all(&temp_dir);
    let progress_file = temp_dir.join("learning_progress.json");

    // 1. Session 1: Launch application (fresh AppState with custom test path)
    let mut state1 = seeded_state();
    state1.progress_path = Some(progress_file.clone());
    *state1.progress_store.lock().unwrap() = crate::load_progress_store(Some(&progress_file));

    let cur_res1 = execute_query(&state1, Query::GetCurriculum).unwrap();
    if let QueryResponse::Curriculum { summary, .. } = cur_res1 {
        assert_eq!(summary.completed_lessons, 0);
    }

    // Start lesson and complete exercise
    execute_command(
        &state1,
        Command::StartLesson {
            lesson_id: "b4.handshake".into(),
        },
    )
    .unwrap();

    let val_res = execute_query(
        &state1,
        Query::ValidateExerciseChoice {
            lesson_id: "b4.handshake".into(),
            exercise_id: "tcp.identify.syn".into(),
            choice_index: 0,
        },
    )
    .unwrap();
    if let QueryResponse::ExerciseValidation { outcome } = val_res {
        assert!(outcome.is_correct);
        assert_eq!(outcome.status, "completed");
    }

    // Verify file written to disk
    assert!(progress_file.exists(), "Progress file must exist on disk");
    let file_content = std::fs::read_to_string(&progress_file).unwrap();
    assert!(file_content.contains("b4.handshake"));

    // 2. Session 2: Simulating full Application Restart (Brand new AppState instance restoring from disk)
    let mut state2 = seeded_state();
    state2.progress_path = Some(progress_file.clone());
    *state2.progress_store.lock().unwrap() = crate::load_progress_store(Some(&progress_file));

    let cur_res2 = execute_query(&state2, Query::GetCurriculum).unwrap();
    if let QueryResponse::Curriculum { modules, summary } = cur_res2 {
        assert_eq!(
            summary.completed_lessons, 1,
            "Completed lessons must be restored from disk"
        );
        assert!(
            summary.overall_mastery_pct > 0,
            "Mastery must be restored from disk"
        );
        let handshake_lesson = modules
            .iter()
            .flat_map(|m| &m.lessons)
            .find(|l| l.id == "b4.handshake")
            .expect("b4.handshake lesson must exist");
        assert_eq!(handshake_lesson.status, "completed");
        assert!(handshake_lesson.mastery > 0.0);
    } else {
        panic!("expected Curriculum response");
    }

    // Clean up
    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_stage_probe_target_validation_and_rejection() {
    use netpulse_api::dto::{DiagnosticChainStageKindDto, StageProbeStatusDto};

    let state = seeded_state();

    // 1. Device stage is local stack; succeeds without any target
    let res = execute_query(
        &state,
        Query::RunStageProbe {
            stage: DiagnosticChainStageKindDto::Device,
            target: None,
        },
    )
    .unwrap();
    if let QueryResponse::StageProbeResult { result } = res {
        assert_eq!(result.stage, DiagnosticChainStageKindDto::Device);
        assert_eq!(result.probe_type, "LocalStackProbe");
        assert!(
            result.status == StageProbeStatusDto::Success
                || result.status == StageProbeStatusDto::Degraded
        );
    } else {
        panic!("expected StageProbeResult");
    }

    // 2. Destination stage with invalid/missing targets must strictly return TargetUnavailable
    let invalid_targets = [
        None,
        Some("".to_string()),
        Some("   ".to_string()),
        Some("not-an-ip!#$".to_string()),
        Some("not an ip with spaces".to_string()),
        Some("malicious;cmd.exe".to_string()),
        Some("http://invalid target name/".to_string()),
    ];

    for target in invalid_targets {
        let res = execute_query(
            &state,
            Query::RunStageProbe {
                stage: DiagnosticChainStageKindDto::Destination,
                target: target.clone(),
            },
        )
        .unwrap();

        if let QueryResponse::StageProbeResult { result } = res {
            assert_eq!(
                result.status,
                StageProbeStatusDto::TargetUnavailable,
                "Target '{target:?}' must be rejected with TargetUnavailable"
            );
            assert_eq!(result.target, None);
        } else {
            panic!("expected StageProbeResult");
        }
    }

    // 3. DNS stage with missing or malformed targets must also return TargetUnavailable
    let bad_dns_targets = [
        None,
        Some("".to_string()),
        Some("bad dns host!".to_string()),
    ];
    for target in bad_dns_targets {
        let res = execute_query(
            &state,
            Query::RunStageProbe {
                stage: DiagnosticChainStageKindDto::Dns,
                target: target.clone(),
            },
        )
        .unwrap();

        if let QueryResponse::StageProbeResult { result } = res {
            assert_eq!(
                result.status,
                StageProbeStatusDto::TargetUnavailable,
                "DNS target '{target:?}' must be rejected with TargetUnavailable"
            );
        } else {
            panic!("expected StageProbeResult");
        }
    }

    // 4. ISP stage with missing target must return TargetUnavailable
    let res = execute_query(
        &state,
        Query::RunStageProbe {
            stage: DiagnosticChainStageKindDto::Isp,
            target: None,
        },
    )
    .unwrap();
    if let QueryResponse::StageProbeResult { result } = res {
        assert_eq!(result.status, StageProbeStatusDto::TargetUnavailable);
    } else {
        panic!("expected StageProbeResult");
    }
}

#[test]
fn test_monitor_snapshot_query_enforces_standby_when_capture_inactive() {
    let state = seeded_state();

    // Confirm capture is not actively running (capture is None)
    {
        let ctrl = state.capture.lock().unwrap();
        assert!(ctrl.is_none());
    }

    // Execute on-demand Query::MonitorSnapshot
    let res = execute_query(
        &state,
        Query::MonitorSnapshot {
            from_mono_nanos: None,
            to_mono_nanos: None,
            time_range: None,
        },
    )
    .unwrap();

    if let QueryResponse::MonitorSnapshot { snapshot } = res {
        // Even with store queries, telemetry_state must be Standby
        // because capture lifecycle strictly dominates.
        assert_eq!(
            snapshot.telemetry_state,
            netpulse_api::dto::TelemetryStateDto::Standby,
            "On-demand monitor snapshot with inactive capture must return Standby"
        );

        // Verify that subsystems truthfully report Standby (not Capturing or 7 Hops Grounded)
        let subs = &snapshot.subsystems;
        if let Some(cap) = subs.iter().find(|s| s.name == "Capture Pipeline") {
            assert_eq!(
                cap.detail, "Standby",
                "Capture Pipeline must be Standby when inactive"
            );
        }
        if let Some(driver) = subs.iter().find(|s| s.name == "Network Driver") {
            assert_eq!(
                driver.detail, "Standby",
                "Network Driver must be Standby when inactive"
            );
        }
        if let Some(diag) = subs.iter().find(|s| s.name == "Diagnostic Engine") {
            assert_eq!(
                diag.detail, "Standby",
                "Diagnostic Engine must be Standby when inactive and 0 flows"
            );
        }
    } else {
        panic!("expected MonitorSnapshot response");
    }
}

#[test]
fn test_query_list_sessions() {
    let state = seeded_state();
    {
        let mut store = state.store.lock().unwrap();
        store.insert_session(netpulse_core::Session {
            id: 42,
            process_id: 0,
            start_ts: netpulse_core::Timestamp::new(500_000, 0),
            trigger: "resolved and connected to github.com".into(),
            flow_ids: vec![10, 11, 12],
        });
    }

    let res = execute_query(&state, Query::ListSessions).unwrap();
    match res {
        QueryResponse::Sessions { sessions } => {
            let s = sessions
                .iter()
                .find(|s| s.id == 42)
                .expect("session 42 found");
            assert_eq!(s.domain, "github.com");
            assert_eq!(s.start_mono_nanos, 500_000);
            assert_eq!(s.flow_count, 3);
        }
        _ => panic!("expected Sessions response"),
    }
}

fn make_dns_query_frame(domain: &str) -> Vec<u8> {
    let mut dns_msg = vec![0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
    for label in domain.split('.') {
        dns_msg.push(label.len() as u8);
        dns_msg.extend_from_slice(label.as_bytes());
    }
    dns_msg.push(0);
    dns_msg.extend_from_slice(&[0x00, 0x01, 0x00, 0x01]); // A record, IN class

    let mut udp = Vec::new();
    udp.extend_from_slice(&53000u16.to_be_bytes()); // src port
    udp.extend_from_slice(&53u16.to_be_bytes()); // dst port 53
    udp.extend_from_slice(&((dns_msg.len() + 8) as u16).to_be_bytes());
    udp.extend_from_slice(&[0, 0]); // checksum
    udp.extend_from_slice(&dns_msg);

    let mut ip = vec![0x45, 0x00];
    ip.extend_from_slice(&((20 + udp.len()) as u16).to_be_bytes());
    ip.extend_from_slice(&[0x00, 0x00, 0x40, 0x00, 0x40, 17, 0x00, 0x00]); // TTL=64, UDP
    ip.extend_from_slice(&[192, 168, 1, 100]); // src
    ip.extend_from_slice(&[8, 8, 8, 8]); // dst 8.8.8.8
    ip.extend_from_slice(&udp);

    let mut frame = vec![0; 12];
    frame.extend_from_slice(&0x0800u16.to_be_bytes());
    frame.extend_from_slice(&ip);
    frame
}

fn make_http_get_frame(host: &str, path: &str) -> Vec<u8> {
    let payload = format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: NetPulse/1.0\r\n\r\n");
    let payload_bytes = payload.as_bytes();

    let mut tcp = Vec::new();
    tcp.extend_from_slice(&49152u16.to_be_bytes()); // src port
    tcp.extend_from_slice(&80u16.to_be_bytes()); // dst port 80
    tcp.extend_from_slice(&100_000u32.to_be_bytes()); // seq
    tcp.extend_from_slice(&0u32.to_be_bytes()); // ack
    tcp.push(0x50); // data offset 5
    tcp.push(0x18); // PSH + ACK
    tcp.extend_from_slice(&65535u16.to_be_bytes()); // window
    tcp.extend_from_slice(&[0, 0]); // checksum
    tcp.extend_from_slice(&[0, 0]); // urgent
    tcp.extend_from_slice(payload_bytes);

    let mut ip = vec![0x45, 0x00];
    ip.extend_from_slice(&((20 + tcp.len()) as u16).to_be_bytes());
    ip.extend_from_slice(&[0x00, 0x01, 0x40, 0x00, 0x40, 6, 0x00, 0x00]); // TTL=64, TCP
    ip.extend_from_slice(&[192, 168, 1, 100]);
    ip.extend_from_slice(&[93, 184, 216, 34]); // example.com IP
    ip.extend_from_slice(&tcp);

    let mut frame = vec![0; 12];
    frame.extend_from_slice(&0x0800u16.to_be_bytes());
    frame.extend_from_slice(&ip);
    frame
}

fn make_tls_client_hello_frame(sni_host: &str) -> Vec<u8> {
    let mut sni_ext = Vec::new();
    let server_name = sni_host.as_bytes();
    let name_entry_len = 1 + 2 + server_name.len();
    sni_ext.extend_from_slice(&(name_entry_len as u16).to_be_bytes());
    sni_ext.push(0); // host_name
    sni_ext.extend_from_slice(&(server_name.len() as u16).to_be_bytes());
    sni_ext.extend_from_slice(server_name);

    let mut alpn_ext = Vec::new();
    let proto = b"h2";
    let list_len = 1 + proto.len();
    alpn_ext.extend_from_slice(&(list_len as u16).to_be_bytes());
    alpn_ext.push(proto.len() as u8);
    alpn_ext.extend_from_slice(proto);

    let mut exts = Vec::new();
    exts.extend_from_slice(&0u16.to_be_bytes()); // EXT_SNI
    exts.extend_from_slice(&(sni_ext.len() as u16).to_be_bytes());
    exts.extend_from_slice(&sni_ext);
    exts.extend_from_slice(&16u16.to_be_bytes()); // EXT_ALPN
    exts.extend_from_slice(&(alpn_ext.len() as u16).to_be_bytes());
    exts.extend_from_slice(&alpn_ext);

    let mut ch = Vec::new();
    ch.extend_from_slice(&[0x03, 0x03]); // TLS 1.2
    ch.extend_from_slice(&[0x42u8; 32]); // random
    ch.push(0); // session id len
    ch.extend_from_slice(&[0x00, 0x02, 0x13, 0x01]); // cipher suites
    ch.extend_from_slice(&[0x01, 0x00]); // compression null
    ch.extend_from_slice(&(exts.len() as u16).to_be_bytes());
    ch.extend_from_slice(&exts);

    let mut hs = vec![1u8]; // ClientHello
    let l = ch.len();
    hs.push((l >> 16) as u8);
    hs.extend_from_slice(&(l as u16).to_be_bytes());
    hs.extend_from_slice(&ch);

    let mut rec = vec![22u8, 0x03, 0x01]; // Handshake, TLS 1.0
    rec.extend_from_slice(&(hs.len() as u16).to_be_bytes());
    rec.extend_from_slice(&hs);

    let mut tcp = Vec::new();
    tcp.extend_from_slice(&49153u16.to_be_bytes()); // src port
    tcp.extend_from_slice(&443u16.to_be_bytes()); // dst port 443
    tcp.extend_from_slice(&200_000u32.to_be_bytes()); // seq
    tcp.extend_from_slice(&0u32.to_be_bytes()); // ack
    tcp.push(0x50); // data offset 5
    tcp.push(0x18); // PSH + ACK
    tcp.extend_from_slice(&65535u16.to_be_bytes());
    tcp.extend_from_slice(&[0, 0]);
    tcp.extend_from_slice(&[0, 0]);
    tcp.extend_from_slice(&rec);

    let mut ip = vec![0x45, 0x00];
    ip.extend_from_slice(&((20 + tcp.len()) as u16).to_be_bytes());
    ip.extend_from_slice(&[0x00, 0x02, 0x40, 0x00, 0x40, 6, 0x00, 0x00]); // TCP
    ip.extend_from_slice(&[192, 168, 1, 100]);
    ip.extend_from_slice(&[104, 16, 132, 229]); // cloudflare IP
    ip.extend_from_slice(&tcp);

    let mut frame = vec![0; 12];
    frame.extend_from_slice(&0x0800u16.to_be_bytes());
    frame.extend_from_slice(&ip);
    frame
}

#[test]
fn test_full_slice_capture_to_presentation_lifecycle() {
    use crate::CaptureControl;
    use netpulse_api::dto::{DiagnosticChainStageKindDto, StageProbeStatusDto, TelemetryStateDto};
    use netpulse_core::traits::RawFrame;
    use netpulse_engine::pipeline::LivePipeline;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    let state = seeded_state();

    // 1. Establish active capture control state
    let stop = Arc::new(AtomicBool::new(false));
    let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();
    let stop_thread = Arc::clone(&stop);
    let handle = std::thread::spawn(move || {
        let _guard = crate::CompletionGuard(Some(done_tx));
        while !stop_thread.load(std::sync::atomic::Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    });
    *state.capture.lock().unwrap() = Some(CaptureControl {
        stop,
        done_rx,
        handle,
    });

    // Verify StartCapture command dispatch honors active capture state
    let dup_start = execute_command(&state, Command::StartCapture { iface_id: 0 });
    assert!(dup_start.is_err(), "Duplicate start must be refused when capture is running");
    assert!(state.capture.lock().unwrap().is_some(), "Capture handle must be active");

    // 2. Generate network traffic (HTTP, DNS, TLS raw frames)
    let dns_frame = make_dns_query_frame("api.example.com");
    let http_frame = make_http_get_frame("api.example.com", "/v1/telemetry");
    let tls_frame = make_tls_client_hello_frame("secure.example.com");

    let raw_frames = vec![
        RawFrame {
            mono_nanos: 1_000_000,
            iface_id: 1,
            bytes: dns_frame,
        },
        RawFrame {
            mono_nanos: 2_000_000,
            iface_id: 1,
            bytes: http_frame,
        },
        RawFrame {
            mono_nanos: 3_000_000,
            iface_id: 1,
            bytes: tls_frame,
        },
    ];

    // 3. Observe raw frames decoded in netpulse-decode, flow-tracked in netpulse-flow, committed in netpulse-storage
    {
        // Decode directly and verify L7 protocol resolution
        let d_dns = netpulse_decode::decode_frame(netpulse_decode::LinkType::Ethernet, &raw_frames[0].bytes);
        assert_eq!(d_dns.l7, netpulse_core::net::L7Proto::Dns);
        assert_eq!(d_dns.events, vec![netpulse_core::ProtoEventKind::DnsQuery]);

        let d_http = netpulse_decode::decode_frame(netpulse_decode::LinkType::Ethernet, &raw_frames[1].bytes);
        assert_eq!(d_http.l7, netpulse_core::net::L7Proto::Http1);
        assert_eq!(d_http.events, vec![netpulse_core::ProtoEventKind::HttpRequest]);

        let d_tls = netpulse_decode::decode_frame(netpulse_decode::LinkType::Ethernet, &raw_frames[2].bytes);
        assert_eq!(d_tls.l7, netpulse_core::net::L7Proto::Tls);
        assert_eq!(d_tls.events, vec![netpulse_core::ProtoEventKind::TlsClientHello]);

        // Ingest into LivePipeline and commit to store
        let mut pipeline = LivePipeline::new(1, 16); // 1 = Ethernet DLT
        pipeline.ingest_batch(&raw_frames);

        let mut store = state.store.lock().unwrap();
        pipeline.commit_to_store(&mut store, 3_000_000);
        pipeline.finish(&mut store);

        assert!(store.flow_count() >= 3, "All 3 flows must be committed into CaptureStore");
    }

    // Update capture stats with the processed frames
    {
        let mut stats = state.stats.lock().unwrap();
        stats.received = 3;
        stats.dropped = 0;
    }

    // 4. Verify Query::MonitorSnapshot returns populated MonitorSnapshotDto with telemetry_state: Active
    let snap_res = execute_query(
        &state,
        Query::MonitorSnapshot {
            from_mono_nanos: None,
            to_mono_nanos: None,
            time_range: None,
        },
    )
    .expect("MonitorSnapshot query must succeed");

    if let QueryResponse::MonitorSnapshot { snapshot } = snap_res {
        assert_eq!(
            snapshot.telemetry_state,
            TelemetryStateDto::Active,
            "Active capture with flows must report telemetry_state: Active"
        );
        assert!(!snapshot.by_protocol.rows.is_empty(), "Protocols breakdown must be populated");
        assert!(!snapshot.by_host.rows.is_empty(), "Host breakdown must be populated");
        assert!(snapshot.diagnostic_chain.is_some(), "Diagnostic chain must be present");
        let chain = snapshot.diagnostic_chain.as_ref().unwrap();
        assert_eq!(chain.stages.len(), 7, "Diagnostic chain must contain 7 grounded stages");
    } else {
        panic!("expected MonitorSnapshot response");
    }

    // 5. Stop capture; verify telemetry_state immediately updates to Standby
    execute_command(&state, Command::StopCapture { iface_id: 0 }).expect("StopCapture command must succeed");
    assert!(state.capture.lock().unwrap().is_none(), "Capture handle must be None after stop");

    let standby_res = execute_query(
        &state,
        Query::MonitorSnapshot {
            from_mono_nanos: None,
            to_mono_nanos: None,
            time_range: None,
        },
    )
    .expect("MonitorSnapshot after stop must succeed");

    if let QueryResponse::MonitorSnapshot { snapshot } = standby_res {
        assert_eq!(
            snapshot.telemetry_state,
            TelemetryStateDto::Standby,
            "After stop_capture, telemetry_state must immediately report Standby"
        );
    } else {
        panic!("expected MonitorSnapshot response");
    }

    // 6. Run active stage probe; verify IPC result
    let probe_res = execute_query(
        &state,
        Query::RunStageProbe {
            stage: DiagnosticChainStageKindDto::Device,
            target: None,
        },
    )
    .expect("RunStageProbe for Device must succeed");

    if let QueryResponse::StageProbeResult { result } = probe_res {
        assert_eq!(result.stage, DiagnosticChainStageKindDto::Device);
        assert_eq!(result.probe_type, "LocalStackProbe");
        assert_eq!(result.status, StageProbeStatusDto::Success);
        assert!(result.summary.contains("Local capture stack verified"));
    } else {
        panic!("expected StageProbeResult");
    }
}

