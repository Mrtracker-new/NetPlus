use super::test_support::seeded_state;
use super::{execute_command, execute_query};
use netpulse_api::{
    handshake_codes, handshake_error_codes, Command, ExportFormatDto, ExportSelectionDto,
    ProjectionDepth, Query, QueryResponse,
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
    assert_eq!(a.recordings.lock().unwrap().len(), b.recordings.lock().unwrap().len());
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
        assert_eq!(plugins.len(), 4);
        let names: Vec<_> = plugins.iter().map(|p| p.name.as_str()).collect();
        assert!(names.contains(&"example-dissector"));
        assert!(names.contains(&"example-detector"));
        assert!(names.contains(&"example-enrichment"));
        assert!(names.contains(&"example-export"));

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
            from_mono_nanos: 0,
            to_mono_nanos: 1_000_000,
            depth: ProjectionDepth::Beginner,
        },
    )
    .unwrap();
    assert!(matches!(res, QueryResponse::NarrativeFeed { .. }));
}

#[test]
fn test_query_monitor_snapshot() {
    let state = seeded_state();
    let res = execute_query(
        &state,
        Query::MonitorSnapshot {
            from_mono_nanos: 0,
            to_mono_nanos: 1_000_000,
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
        assert!(entries.is_empty(), "nonexistent term should return empty list rather than error");
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
    execute_command(&state, Command::SetDepth { depth: ProjectionDepth::Expert }).unwrap();
    assert_eq!(*state.depth.lock().unwrap(), netpulse_core::Depth::Expert);

    // Transition to Intermediate
    execute_command(&state, Command::SetDepth { depth: ProjectionDepth::Intermediate }).unwrap();
    assert_eq!(*state.depth.lock().unwrap(), netpulse_core::Depth::Intermediate);
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
        let p = reg.plugins().iter().find(|p| p.manifest.metadata.name == "community-plugin").unwrap();
        assert!(!p.enabled);
    }

    // Enable plugin -> verify state transition
    execute_command(&state, Command::EnablePlugin { name: "community-plugin".into() }).unwrap();
    {
        let reg = state.registry.lock().unwrap();
        let p = reg.plugins().iter().find(|p| p.manifest.metadata.name == "community-plugin").unwrap();
        assert!(p.enabled);
    }

    // Disable plugin -> verify state transition
    execute_command(&state, Command::DisablePlugin { name: "community-plugin".into() }).unwrap();
    {
        let reg = state.registry.lock().unwrap();
        let p = reg.plugins().iter().find(|p| p.manifest.metadata.name == "community-plugin").unwrap();
        assert!(!p.enabled);
    }

    // Test ConfigurePlugin, PatchPluginConfig, and ResetPluginConfig
    execute_command(&state, Command::ConfigurePlugin {
        name: "community-plugin".into(),
        config: serde_json::json!({ "threshold": 10 }),
    }).unwrap();
    {
        let reg = state.registry.lock().unwrap();
        let p = reg.plugins().iter().find(|p| p.manifest.metadata.name == "community-plugin").unwrap();
        assert_eq!(p.config["threshold"], 10);
    }

    execute_command(&state, Command::PatchPluginConfig {
        name: "community-plugin".into(),
        expected_version: Some(1),
        patch: serde_json::json!({ "threshold": 12 }),
    }).unwrap();
    {
        let reg = state.registry.lock().unwrap();
        let p = reg.plugins().iter().find(|p| p.manifest.metadata.name == "community-plugin").unwrap();
        assert_eq!(p.config["threshold"], 12);
    }

    execute_command(&state, Command::ResetPluginConfig {
        name: "community-plugin".into(),
    }).unwrap();
    {
        let reg = state.registry.lock().unwrap();
        let p = reg.plugins().iter().find(|p| p.manifest.metadata.name == "community-plugin").unwrap();
        assert_eq!(p.config["threshold"], 5);
    }

}

#[test]
fn test_command_plugin_idempotency_and_unknown_refusal() {
    let state = seeded_state();

    // Enabling an unknown plugin fails honestly
    let res = execute_command(&state, Command::EnablePlugin { name: "unknown-plugin".into() });
    assert!(res.is_err());
    assert_eq!(res.unwrap_err(), "cannot enable plugin 'unknown-plugin'");

    // Disabling an unknown plugin fails honestly
    let res_dis = execute_command(&state, Command::DisablePlugin { name: "unknown-plugin".into() });
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
    assert!(res_start.unwrap_err().contains("recording requires a live capture source"));

    let res_stop = execute_command(&state, Command::StopRecording);
    assert!(res_stop.is_err());
    assert!(res_stop.unwrap_err().contains("recording requires a live capture source"));
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
