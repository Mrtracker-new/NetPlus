//! # netpulse-core telemetry & structured logging
//!
//! Provides enterprise-grade observability infrastructure built on top of `tracing`,
//! `tracing-subscriber`, `time`, and `thiserror`.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(feature = "sentry")]
use std::sync::Arc;
use std::sync::OnceLock;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

static TELEMETRY_INITIALIZED: OnceLock<()> = OnceLock::new();
static PANIC_HOOK_ENTERED: AtomicBool = AtomicBool::new(false);

/// Error types for telemetry initialization and runtime operation.
#[derive(Debug, thiserror::Error)]
pub enum TelemetryError {
    /// Returned when `init_telemetry` is called more than once per process.
    #[error("Telemetry subscriber is already initialized")]
    AlreadyInitialized,

    /// Failure during subscriber construction or global setter.
    #[error("Failed to initialize telemetry subscriber: {0}")]
    InitializationFailed(String),

    /// Failure configuring output sinks or file appenders.
    #[error("Telemetry file appender error: {0}")]
    FileAppenderError(String),
}

/// Output formatting options for log events.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogFormat {
    /// Human-readable compact text format (default for terminal/CLI).
    Compact,
    /// Detailed multi-line text format.
    Full,
    /// Machine-readable JSON lines format (RFC-3339 UTC timestamps, structured fields).
    Json,
}

/// Rolling file configuration for log persistence.
#[derive(Debug, Clone)]
pub struct FileLogConfig {
    /// Directory where log files are stored.
    pub directory: PathBuf,
    /// File prefix, e.g. `netpulse-engine.log`.
    pub file_name_prefix: String,
}

/// Configuration for Sentry crash reporting and error tracking.
#[derive(Debug, Clone)]
pub struct CrashReportingConfig {
    /// Whether crash reporting is enabled.
    pub enabled: bool,
    /// DSN URL for Sentry integration.
    pub dsn: Option<String>,
    /// Normalized environment (e.g. `production`, `staging`, `development`).
    pub environment: String,
    /// Release version tag (e.g. `netpulse-engine@0.1.0+build`).
    pub release: String,
    /// Error event sample rate (clamped 0.0..=1.0).
    pub sample_rate: f32,
    /// Traces sample rate (clamped 0.0..=1.0).
    pub traces_sample_rate: f32,
    /// Whether to attach stacktraces to message events.
    pub attach_stacktrace: bool,
    /// Send default PII — hardcoded `false` for NetPulse privacy policy.
    pub send_default_pii: bool,
}

impl CrashReportingConfig {
    pub fn new(service_name: &str, version: &str) -> Self {
        let release = format!("{}@{}", service_name, version);
        Self {
            enabled: false,
            dsn: None,
            environment: "development".to_string(),
            release,
            sample_rate: 1.0,
            traces_sample_rate: 0.1,
            attach_stacktrace: true,
            send_default_pii: false,
        }
    }
}

/// Pure configuration struct governing telemetry initialization.
#[derive(Debug, Clone)]
pub struct TelemetryConfig {
    /// Service or application identifier (e.g. `netpulse-engine`).
    pub service_name: String,
    /// Application version string.
    pub version: String,
    /// Output formatting mode.
    pub format: LogFormat,
    /// RUST_LOG filter directive override (if None, env or profile defaults apply).
    pub filter_directive: Option<String>,
    /// Optional file appender configuration.
    pub file_config: Option<FileLogConfig>,
    /// Crash reporting configuration.
    pub crash_reporting: CrashReportingConfig,
    /// Force offline mode override.
    pub offline: bool,
}

impl TelemetryConfig {
    /// Construct a new `TelemetryConfig` with defaults for the given service.
    pub fn new(service_name: impl Into<String>, version: impl Into<String>) -> Self {
        let svc = service_name.into();
        let ver = version.into();
        let crash_reporting = CrashReportingConfig::new(&svc, &ver);
        Self {
            service_name: svc,
            version: ver,
            format: LogFormat::Compact,
            filter_directive: None,
            file_config: None,
            crash_reporting,
            offline: false,
        }
    }
}

/// Opaque handle returned upon successful telemetry initialization.
///
/// Holds internal resources such as background non-blocking file guards and sentry guards.
pub struct TelemetryHandle {
    #[cfg(feature = "file")]
    _file_guard: Option<tracing_appender::non_blocking::WorkerGuard>,
    #[cfg(feature = "sentry")]
    _sentry_guard: Option<sentry::ClientInitGuard>,
}

impl std::fmt::Debug for TelemetryHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TelemetryHandle").finish_non_exhaustive()
    }
}

/// Helper to scrub PII and sensitive headers from string inputs idempotently.
pub fn scrub_pii_string(input: &str) -> String {
    let mut scrubbed = input.to_string();

    // 1. Redact Authorization / Bearer / Cookie headers idempotently
    if scrubbed.contains("Authorization:") {
        scrubbed = scrubbed
            .lines()
            .map(|line| {
                if line.trim_start().starts_with("Authorization:") {
                    "Authorization: [REDACTED]".to_string()
                } else {
                    line.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
    }

    if scrubbed.contains("Cookie:") {
        scrubbed = scrubbed
            .lines()
            .map(|line| {
                if line.trim_start().starts_with("Cookie:") {
                    "Cookie: [REDACTED]".to_string()
                } else {
                    line.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
    }

    if scrubbed.contains("Set-Cookie:") {
        scrubbed = scrubbed
            .lines()
            .map(|line| {
                if line.trim_start().starts_with("Set-Cookie:") {
                    "Set-Cookie: [REDACTED]".to_string()
                } else {
                    line.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
    }

    // 2. Redact home directories safely
    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        if !home.trim().is_empty() && scrubbed.contains(&home) {
            scrubbed = scrubbed.replace(&home, "[REDACTED_PATH]");
        }
    }

    scrubbed
}

/// Read process environment variables to build a [`TelemetryConfig`].
pub fn read_env_config(
    service_name: impl Into<String>,
    version: impl Into<String>,
) -> TelemetryConfig {
    let mut config = TelemetryConfig::new(service_name, version);

    // Offline mode override
    if let Ok(val) = std::env::var("NETPULSE_OFFLINE") {
        if val.eq_ignore_ascii_case("true") || val == "1" {
            config.offline = true;
        }
    }

    if let Ok(val) = std::env::var("RUST_LOG_FORMAT") {
        match val.to_lowercase().as_str() {
            "json" => config.format = LogFormat::Json,
            "full" => config.format = LogFormat::Full,
            _ => config.format = LogFormat::Compact,
        }
    }

    if let Ok(filter) = std::env::var("RUST_LOG") {
        if !filter.trim().is_empty() {
            config.filter_directive = Some(filter);
        }
    }

    // Crash reporting configuration parsing
    if !config.offline {
        let dsn = std::env::var("NETPULSE_SENTRY_DSN")
            .or_else(|_| std::env::var("SENTRY_DSN"))
            .ok();

        if let Some(dsn_val) = dsn {
            if !dsn_val.trim().is_empty() {
                config.crash_reporting.dsn = Some(dsn_val);
                config.crash_reporting.enabled = true;
            }
        }

        if let Ok(env_val) = std::env::var("SENTRY_ENVIRONMENT") {
            config.crash_reporting.environment = match env_val.to_lowercase().as_str() {
                "prod" | "production" => "production".to_string(),
                "stage" | "staging" => "staging".to_string(),
                "test" => "test".to_string(),
                _ => "development".to_string(),
            };
        }

        if let Ok(rate_str) = std::env::var("SENTRY_SAMPLE_RATE") {
            if let Ok(rate) = rate_str.parse::<f32>() {
                config.crash_reporting.sample_rate = rate.clamp(0.0, 1.0);
            }
        }
    }

    config
}

/// Build an [`EnvFilter`] with safe fallback behavior.
fn build_env_filter(override_directive: Option<&str>) -> EnvFilter {
    if let Some(dir) = override_directive {
        if let Ok(filter) = EnvFilter::try_new(dir) {
            return filter;
        }
    }

    if let Ok(filter) = EnvFilter::try_from_default_env() {
        filter
    } else if cfg!(debug_assertions) {
        EnvFilter::new("debug")
    } else {
        EnvFilter::new("info")
    }
}

/// Install a panic hook that logs structured `tracing::error!` events while preserving the default panic handler.
pub fn init_panic_hook() {
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Prevent recursive panic logging loops
        if PANIC_HOOK_ENTERED.swap(true, Ordering::SeqCst) {
            previous_hook(info);
            return;
        }

        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown".to_string());

        let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "Box<dyn Any>".to_string()
        };

        let scrubbed_payload = scrub_pii_string(&payload);

        tracing::error!(
            event = "system.panic",
            location = %location,
            panic_message = %scrubbed_payload,
            "Unhandled thread panic"
        );

        PANIC_HOOK_ENTERED.store(false, Ordering::SeqCst);
        previous_hook(info);
    }));
}

/// Initialize structured logging for the current process.
pub fn init_telemetry(config: TelemetryConfig) -> Result<TelemetryHandle, TelemetryError> {
    if TELEMETRY_INITIALIZED.set(()).is_err() {
        return Err(TelemetryError::AlreadyInitialized);
    }

    let env_filter = build_env_filter(config.filter_directive.as_deref());
    let registry = tracing_subscriber::registry().with(env_filter);

    let timer = tracing_subscriber::fmt::time::UtcTime::rfc_3339();

    #[cfg(feature = "file")]
    let mut file_guard = None;

    #[cfg(feature = "sentry")]
    let mut _sentry_guard = None;

    #[cfg(feature = "sentry")]
    if config.crash_reporting.enabled && !config.offline {
        if let Some(dsn) = &config.crash_reporting.dsn {
            let mut opts = sentry::ClientOptions::default();
            opts.dsn = dsn.parse().ok();
            opts.release = Some(config.crash_reporting.release.clone().into());
            opts.environment = Some(config.crash_reporting.environment.clone().into());
            opts.sample_rate = config.crash_reporting.sample_rate;
            opts.traces_sample_rate = config.crash_reporting.traces_sample_rate;
            opts.attach_stacktrace = config.crash_reporting.attach_stacktrace;
            opts.send_default_pii = false;
            opts.server_name = None; // Never send local hostname
            opts.max_breadcrumbs = 100;

            opts.before_send = Some(Arc::new(|mut event| {
                event.server_name = None;
                event.user = None;
                if let Some(msg) = &mut event.message {
                    *msg = scrub_pii_string(msg);
                }
                Some(event)
            }));

            opts.before_breadcrumb = Some(Arc::new(|mut breadcrumb| {
                if let Some(msg) = &mut breadcrumb.message {
                    *msg = scrub_pii_string(msg);
                    if msg.len() > 512 {
                        msg.truncate(512);
                    }
                }
                Some(breadcrumb)
            }));

            let guard = sentry::init(opts);
            _sentry_guard = Some(guard);

            let sentry_layer = sentry_tracing::layer();
            let registry = registry.with(sentry_layer);

            match config.format {
                LogFormat::Compact => {
                    let stdout_layer = tracing_subscriber::fmt::layer().compact().with_timer(timer);
                    registry
                        .with(stdout_layer)
                        .try_init()
                        .map_err(|e| TelemetryError::InitializationFailed(e.to_string()))?;
                }
                LogFormat::Full => {
                    let stdout_layer = tracing_subscriber::fmt::layer().with_timer(timer);
                    registry
                        .with(stdout_layer)
                        .try_init()
                        .map_err(|e| TelemetryError::InitializationFailed(e.to_string()))?;
                }
                #[cfg(feature = "json")]
                LogFormat::Json => {
                    let stdout_layer = tracing_subscriber::fmt::layer().json().with_timer(timer);
                    registry
                        .with(stdout_layer)
                        .try_init()
                        .map_err(|e| TelemetryError::InitializationFailed(e.to_string()))?;
                }
                #[cfg(not(feature = "json"))]
                LogFormat::Json => {
                    return Err(TelemetryError::InitializationFailed(
                        "JSON logging feature is not enabled in this build.".into(),
                    ));
                }
            }

            init_panic_hook();

            tracing::info!(
                event = "telemetry.initialized",
                service = %config.service_name,
                version = %config.version,
                crash_reporting = true,
                offline = config.offline,
                environment = %config.crash_reporting.environment,
                "Telemetry subsystem initialized with Sentry crash reporting"
            );

            return Ok(TelemetryHandle {
                #[cfg(feature = "file")]
                _file_guard: file_guard,
                #[cfg(feature = "sentry")]
                _sentry_guard: sentry_guard,
            });
        }
    }

    match config.format {
        #[cfg(feature = "json")]
        LogFormat::Json => {
            let stdout_layer = tracing_subscriber::fmt::layer().json().with_timer(timer);
            registry
                .with(stdout_layer)
                .try_init()
                .map_err(|e| TelemetryError::InitializationFailed(e.to_string()))?;
        }
        #[cfg(not(feature = "json"))]
        LogFormat::Json => {
            return Err(TelemetryError::InitializationFailed(
                "JSON logging feature is not enabled in this build.".into(),
            ));
        }
        LogFormat::Full => {
            let stdout_layer = tracing_subscriber::fmt::layer().with_timer(timer);
            registry
                .with(stdout_layer)
                .try_init()
                .map_err(|e| TelemetryError::InitializationFailed(e.to_string()))?;
        }
        LogFormat::Compact => {
            let stdout_layer = tracing_subscriber::fmt::layer().compact().with_timer(timer);
            registry
                .with(stdout_layer)
                .try_init()
                .map_err(|e| TelemetryError::InitializationFailed(e.to_string()))?;
        }
    }

    init_panic_hook();

    tracing::info!(
        event = "telemetry.initialized",
        service = %config.service_name,
        version = %config.version,
        crash_reporting = false,
        offline = config.offline,
        "Telemetry subsystem initialized"
    );

    Ok(TelemetryHandle {
        #[cfg(feature = "file")]
        _file_guard: None,
        #[cfg(feature = "sentry")]
        _sentry_guard: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_env_filter_fallback() {
        let filter = build_env_filter(Some("invalid=filter=syntax;;;"));
        let _ = filter;
    }

    #[test]
    fn test_config_builder() {
        let cfg = TelemetryConfig::new("test-svc", "1.0.0");
        assert_eq!(cfg.service_name, "test-svc");
        assert_eq!(cfg.version, "1.0.0");
        assert_eq!(cfg.format, LogFormat::Compact);
    }

    #[test]
    fn test_scrub_pii_string_idempotency() {
        let input = "Authorization: Bearer secret_12345\nCookie: session_abc";
        let first_pass = scrub_pii_string(input);
        assert_eq!(first_pass, "Authorization: [REDACTED]\nCookie: [REDACTED]");

        let second_pass = scrub_pii_string(&first_pass);
        assert_eq!(second_pass, first_pass);
    }

    #[test]
    fn test_sensitive_payload_skipped() {
        let raw_payload = vec![0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0xFF];
        let token = "secret_password_12345";

        #[tracing::instrument(skip(raw_payload, _token), fields(bytes_len = raw_payload.len()))]
        fn process_packet(raw_payload: &[u8], _token: &str) -> usize {
            raw_payload.len()
        }

        assert_eq!(process_packet(&raw_payload, token), 6);
    }
}
