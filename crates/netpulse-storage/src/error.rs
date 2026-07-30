//! Error types for netpulse-storage migrations and repository operations.

use thiserror::Error;

/// Storage migration and database operation errors.
#[derive(Debug, Error)]
pub enum MigrationError {
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
}

pub type Result<T> = std::result::Result<T, MigrationError>;
