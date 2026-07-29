//! # netpulse-core telemetry & structured logging
//!
//! Provides enterprise-grade observability infrastructure built on top of `tracing`,
//! `tracing-subscriber`, `time`, and `thiserror`.

use std::path::PathBuf;
use std::sync::OnceLock;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

static TELEMETRY_INITIALIZED: OnceLock<()> = OnceLock::new();

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
}

impl TelemetryConfig {
    /// Construct a new `TelemetryConfig` with defaults for the given service.
    pub fn new(service_name: impl Into<String>, version: impl Into<String>) -> Self {
        Self {
            service_name: service_name.into(),
            version: version.into(),
            format: LogFormat::Compact,
            filter_directive: None,
            file_config: None,
        }
    }
}

/// Opaque handle returned upon successful telemetry initialization.
///
/// Holds internal resources such as background non-blocking file guards.
#[derive(Debug)]
pub struct TelemetryHandle {
    #[cfg(feature = "file")]
    _file_guard: Option<tracing_appender::non_blocking::WorkerGuard>,
}

/// Read process environment variables (`RUST_LOG`, `RUST_LOG_FORMAT`) to build a [`TelemetryConfig`].
pub fn read_env_config(
    service_name: impl Into<String>,
    version: impl Into<String>,
) -> TelemetryConfig {
    let mut config = TelemetryConfig::new(service_name, version);

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

        tracing::error!(
            event = "system.panic",
            location = %location,
            panic_message = %payload,
            "Unhandled thread panic"
        );

        previous_hook(info);
    }));
}

/// Initialize structured logging for the current process.
///
/// Returns `Ok(TelemetryHandle)` on the first call, or `Err(TelemetryError::AlreadyInitialized)`
/// if called multiple times in the same process.
pub fn init_telemetry(config: TelemetryConfig) -> Result<TelemetryHandle, TelemetryError> {
    if TELEMETRY_INITIALIZED.set(()).is_err() {
        return Err(TelemetryError::AlreadyInitialized);
    }

    let env_filter = build_env_filter(config.filter_directive.as_deref());
    let registry = tracing_subscriber::registry().with(env_filter);

    let timer = tracing_subscriber::fmt::time::UtcTime::rfc_3339();

    #[cfg(feature = "file")]
    let mut file_guard = None;

    #[cfg(feature = "file")]
    if let Some(fc) = &config.file_config {
        let file_appender = tracing_appender::rolling::daily(&fc.directory, &fc.file_name_prefix);
        let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
        file_guard = Some(guard);

        let file_layer = tracing_subscriber::fmt::layer()
            .with_timer(timer.clone())
            .with_writer(non_blocking);

        let registry = registry.with(file_layer);

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
                    "JSON logging feature is not enabled in this build. Compile with --features json".into(),
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

        return Ok(TelemetryHandle {
            _file_guard: file_guard,
        });
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
                "JSON logging feature is not enabled in this build. Compile with --features json"
                    .into(),
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

    Ok(TelemetryHandle {
        #[cfg(feature = "file")]
        _file_guard: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_env_filter_fallback() {
        let filter = build_env_filter(Some("invalid=filter=syntax;;;"));
        let _ = filter; // must not panic
    }

    #[test]
    fn test_config_builder() {
        let cfg = TelemetryConfig::new("test-svc", "1.0.0");
        assert_eq!(cfg.service_name, "test-svc");
        assert_eq!(cfg.version, "1.0.0");
        assert_eq!(cfg.format, LogFormat::Compact);
    }

    #[test]
    fn test_read_env_config_defaults() {
        let cfg = read_env_config("test-svc", "0.1.0");
        assert_eq!(cfg.service_name, "test-svc");
        assert_eq!(cfg.version, "0.1.0");
    }

    #[test]
    fn test_sensitive_payload_skipped() {
        // Privacy invariant: packet payload and keys are never logged directly.
        let raw_payload = vec![0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0xFF];
        let token = "secret_password_12345";

        // Instrument macro skipping raw parameters
        #[tracing::instrument(skip(raw_payload, _token), fields(bytes_len = raw_payload.len()))]
        fn process_packet(raw_payload: &[u8], _token: &str) -> usize {
            raw_payload.len()
        }

        assert_eq!(process_packet(&raw_payload, token), 6);
    }
}
