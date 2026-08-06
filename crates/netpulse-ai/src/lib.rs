//! # netpulse-ai — the egress boundary (Phase 4)
//!
//! The AI Explanation Service: a *grounded* natural-language layer that
//! **explains** the user's captured data and never replaces or invents it
//!The pipeline is retrieval-first: gather the
//! user's real evidence ([`assistant`]), distill it into a compact structured
//! [`context::DistilledContext`], ask a pluggable [`backend::AiBackend`] to
//! explain *that*, and validate every citation against the store before returning
//!Grounding is *checked, not trusted*.
//!
//! **This is the only crate permitted outbound network access**.
//! Confining egress here makes the privacy guarantee auditable: the sole thing
//! that could ever leave the device is a distilled context, and exactly what it
//! discloses is inspectable via
//! [`DistilledContext::disclosure_preview`](context::DistilledContext::disclosure_preview)
//! before any send. The default backend
//! ([`backend::LocalTemplateBackend`]) does **zero** egress, so NetPulse is fully
//! explanatory offline; a remote endpoint is an explicit, disclosed opt-in
//!
#![forbid(unsafe_code)]

pub mod assistant;
pub mod backend;
pub mod context;

pub use assistant::{Assistant, GroundedAnswer};
pub use backend::{AiBackend, LocalTemplateBackend};
pub use context::{DistilledContext, Fact, Intent};

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_storage::{CaptureStore, PayloadPolicy};

    /// The whole crate links: a local assistant answers over an empty store with
    /// an honest decline and zero egress.
    #[test]
    fn crate_links() {
        let store = CaptureStore::new(PayloadPolicy::MetadataOnly);
        let a = Assistant::local().answer(&store, "what happened?");
        assert!(!a.is_remote);
        assert!(!a.grounded); // nothing captured → honest decline
    }

    // NOTE: Keep this list synchronized with the [bans] section in deny.toml.
    const BANNED_NETWORK_CRATES: &[&str] = &[
        "reqwest",
        "hyper",
        "ureq",
        "attohttpc",
        "isahc",
        "surf",
        "tokio-tungstenite",
        "tungstenite",
        "reqwest-middleware",
        "reqwest-eventsource",
        "gloo-net",
        "async-h1",
    ];

    #[test]
    fn test_single_egress_boundary_enforced() {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let workspace_root = manifest_dir
            .parent()
            .and_then(|p| p.parent())
            .expect("Failed to resolve workspace root directory");

        // 1. Read root Cargo.toml to discover workspace member manifests dynamically
        let root_manifest_path = workspace_root.join("Cargo.toml");
        let root_text =
            std::fs::read_to_string(&root_manifest_path).expect("Failed to read root Cargo.toml");
        let root_parsed: toml::Value =
            toml::from_str(&root_text).expect("Failed to parse root Cargo.toml");

        let mut member_patterns = Vec::new();
        if let Some(members) = root_parsed
            .get("workspace")
            .and_then(|w| w.get("members"))
            .and_then(|m| m.as_array())
        {
            for m in members {
                if let Some(s) = m.as_str() {
                    member_patterns.push(s);
                }
            }
        }

        let mut excludes = Vec::new();
        if let Some(ex) = root_parsed
            .get("workspace")
            .and_then(|w| w.get("exclude"))
            .and_then(|e| e.as_array())
        {
            for e in ex {
                if let Some(s) = e.as_str() {
                    excludes.push(s);
                }
            }
        }

        let mut manifests = Vec::new();
        for pattern in member_patterns {
            let glob_path = workspace_root.join(pattern);
            if let Ok(entries) = std::fs::read_dir(glob_path.parent().unwrap_or(workspace_root)) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    let rel = p.strip_prefix(workspace_root).unwrap_or(&p);
                    let rel_str = rel.to_string_lossy().replace('\\', "/");
                    if excludes.iter().any(|ex| rel_str.starts_with(ex)) {
                        continue;
                    }
                    let cargo_toml = p.join("Cargo.toml");
                    if cargo_toml.is_file() && !manifests.contains(&cargo_toml) {
                        manifests.push(cargo_toml);
                    }
                }
            }
        }

        // Also fallback to scanning crates/ and plugins/ directories directly
        for sub in &["crates", "plugins"] {
            let dir = workspace_root.join(sub);
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let cargo_path = entry.path().join("Cargo.toml");
                    if cargo_path.is_file() && !manifests.contains(&cargo_path) {
                        manifests.push(cargo_path);
                    }
                }
            }
        }

        let mut violations = Vec::new();

        for path in manifests {
            let text = match std::fs::read_to_string(&path) {
                Ok(t) => t,
                Err(_) => continue,
            };

            let parsed: toml::Value = match toml::from_str(&text) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let crate_name = parsed
                .get("package")
                .and_then(|p| p.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("");

            if crate_name == "netpulse-ai" {
                continue;
            }

            let mut check_table = |section_name: &str, table: &toml::Value| {
                if let Some(map) = table.as_table() {
                    for (key, val) in map {
                        // Determine actual package name (handle dependency aliases like `my-http = { package = "reqwest", ... }`)
                        let actual_pkg = val
                            .as_table()
                            .and_then(|t| t.get("package"))
                            .and_then(|p| p.as_str())
                            .unwrap_or(key.as_str());

                        if BANNED_NETWORK_CRATES.contains(&actual_pkg) {
                            let rel_path = path.strip_prefix(workspace_root).unwrap_or(&path);
                            violations.push(format!(
                                "  {} -> {}.{} (banned package: {})",
                                rel_path.display(),
                                section_name,
                                key,
                                actual_pkg
                            ));
                        }
                    }
                }
            };

            for dep_sec in &["dependencies", "dev-dependencies", "build-dependencies"] {
                if let Some(table) = parsed.get(*dep_sec) {
                    check_table(dep_sec, table);
                }
            }

            if let Some(target_sec) = parsed.get("target").and_then(|t| t.as_table()) {
                for (target_expr, target_val) in target_sec {
                    if let Some(target_table) = target_val.as_table() {
                        for dep_sec in &["dependencies", "dev-dependencies", "build-dependencies"] {
                            if let Some(table) = target_table.get(*dep_sec) {
                                let label = format!("target.'{}'.{}", target_expr, dep_sec);
                                check_table(&label, table);
                            }
                        }
                    }
                }
            }
        }

        if !violations.is_empty() {
            panic!(
                "\nSingle Egress Boundary violated!\n\
                 Forbidden outbound networking dependencies detected in non-egress crates:\n\n{}\n\n\
                 Only netpulse-ai (docs/02 §10) is permitted outbound network egress.\n",
                violations.join("\n")
            );
        }
    }
}
