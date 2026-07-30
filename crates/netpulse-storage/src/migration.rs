//! Database migration manager for SQLite schema versioning and validation.

use sqlx::{sqlite::SqlitePool, Row};
use std::collections::HashSet;

use crate::error::{MigrationError, Result};

pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// Detailed status of database schema migrations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigrationStatus {
    pub current_version: Option<i64>,
    pub latest_version: i64,
    pub pending: Vec<String>,
    pub applied: Vec<String>,
}

#[derive(Debug)]
pub struct MigrationManager;

impl MigrationManager {
    /// Return the compiled latest migration schema version number.
    pub fn latest_schema() -> i64 {
        MIGRATOR
            .migrations
            .last()
            .map(|m| m.version)
            .unwrap_or(0)
    }

    /// Run all pending embedded migrations against the SQLite database pool.
    pub async fn migrate(pool: &SqlitePool) -> Result<()> {
        MIGRATOR.run(pool).await?;
        Ok(())
    }

    /// Retrieve the current status of applied and pending migrations.
    pub async fn status(pool: &SqlitePool) -> Result<MigrationStatus> {
        let latest_version = Self::latest_schema();

        // Query applied versions from _sqlx_migrations if table exists
        let applied_versions: HashSet<i64> = match sqlx::query(
            "SELECT version FROM _sqlx_migrations WHERE success = 1 ORDER BY version ASC",
        )
        .fetch_all(pool)
        .await
        {
            Ok(rows) => rows.into_iter().map(|r| r.get::<i64, _>("version")).collect(),
            Err(_) => HashSet::new(),
        };

        let current_version = MIGRATOR
            .migrations
            .iter()
            .filter(|m| applied_versions.contains(&m.version))
            .map(|m| m.version)
            .max();

        let mut applied = Vec::new();
        let mut pending = Vec::new();

        for migration in MIGRATOR.migrations.iter() {
            let desc = format!("{:04}_{}", migration.version, migration.description);
            if applied_versions.contains(&migration.version) {
                applied.push(desc);
            } else {
                pending.push(desc);
            }
        }

        Ok(MigrationStatus {
            current_version,
            latest_version,
            pending,
            applied,
        })
    }

    /// Validate essential database tables, PRAGMA flags, and integrity.
    pub async fn validate(pool: &SqlitePool) -> Result<()> {
        // 1. Verify foreign key enforcement is active
        let fk_enabled: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
            .fetch_one(pool)
            .await?;
        if fk_enabled == 0 {
            return Err(MigrationError::IntegrityCheckFailed {
                reason: "PRAGMA foreign_keys is disabled".into(),
            });
        }

        // 2. Verify essential tables exist
        let required_tables = [
            "flows",
            "sessions",
            "proto_events",
            "findings",
            "hosts",
            "host_resolutions",
        ];
        let existing_rows = sqlx::query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('flows', 'sessions', 'proto_events', 'findings', 'hosts', 'host_resolutions')",
        )
        .fetch_all(pool)
        .await?;

        let existing_tables: HashSet<String> = existing_rows
            .into_iter()
            .map(|r| r.get::<String, _>("name"))
            .collect();

        for table in required_tables {
            if !existing_tables.contains(table) {
                return Err(MigrationError::IntegrityCheckFailed {
                    reason: format!("Required table '{table}' is missing"),
                });
            }
        }

        // 3. Execute PRAGMA integrity_check
        let integrity_result: String = sqlx::query_scalar("PRAGMA integrity_check")
            .fetch_one(pool)
            .await?;
        if integrity_result.to_lowercase() != "ok" {
            return Err(MigrationError::IntegrityCheckFailed {
                reason: format!("PRAGMA integrity_check reported error: {integrity_result}"),
            });
        }

        Ok(())
    }
}
