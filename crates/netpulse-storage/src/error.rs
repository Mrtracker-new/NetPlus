//! Error types for netpulse-storage migrations and repository operations.

use thiserror::Error;

/// Storage migration and database operation errors.
#[derive(Debug, Error)]
pub enum StorageError {
    #[error("Database schema version {db_version} is newer than maximum supported version {app_max_version}")]
    DatabaseTooNew {
        db_version: i64,
        app_max_version: i64,
    },

    #[error("Database schema version {db_version} is older than minimum supported version {app_min_version}")]
    DatabaseTooOld {
        db_version: i64,
        app_min_version: i64,
    },

    #[error("Database migration is corrupt: {description}")]
    CorruptMigration { description: String },

    #[error("Missing migration script for version {version}")]
    MissingMigration { version: i64 },

    #[error("Database integrity check failed: {reason}")]
    IntegrityCheckFailed { reason: String },

    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),

    #[error(transparent)]
    Migrate(#[from] sqlx::migrate::MigrateError),

    #[error("Serialization error: {0}")]
    Serialization(serde_json::Error),

    #[error("Deserialization error: {0}")]
    Deserialization(serde_json::Error),

    #[error("Value out of range for SQLite storage: field '{field}' value {value} exceeds maximum supported i64 ({max})")]
    ValueOutOfRange {
        field: &'static str,
        value: u128,
        max: i64,
    },

    #[error(
        "Invalid stored value in SQLite database: field '{field}' contains invalid value {value}"
    )]
    InvalidStoredValue { field: &'static str, value: i64 },

    #[error("Session {session_id} references flow {flow_id} which does not exist in SQLite")]
    MissingFlowForSessionLink { session_id: u64, flow_id: u64 },

    #[error("Storage referential integrity violation: {reason}")]
    IntegrityViolation { reason: String },
}

pub type MigrationError = StorageError;
pub type Result<T> = std::result::Result<T, StorageError>;
