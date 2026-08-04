//! Plugin configuration subsystem: schema validation, merge patching, storage, and lifecycle management.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use netpulse_core::Result as CoreResult;

/// Type-safe wrapper around a standard JSON Schema (Draft 2020) definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JsonSchema(pub serde_json::Value);

impl Eq for JsonSchema {}

impl JsonSchema {
    /// Create a new JSON Schema wrapper.
    pub fn new(schema: serde_json::Value) -> Self {
        Self(schema)
    }

    /// Extract declared storage class for a field path if present in schema properties metadata.
    pub fn storage_class_for(&self, property_name: &str) -> StorageClass {
        if let Some(props) = self.0.get("properties").and_then(|p| p.as_object()) {
            if let Some(field_meta) = props.get(property_name).and_then(|f| f.as_object()) {
                if let Some(sc_str) = field_meta.get("storage_class").and_then(|s| s.as_str()) {
                    return match sc_str {
                        "secret" => StorageClass::Secret,
                        "credential" => StorageClass::Credential,
                        "token" => StorageClass::Token,
                        _ => StorageClass::Normal,
                    };
                }
            }
        }
        StorageClass::Normal
    }
}

/// Categorization for secret and credential configuration fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageClass {
    #[default]
    Normal,
    Secret,
    Credential,
    Token,
}

/// Operation action type for audit logging.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginConfigAction {
    Configure,
    Patch,
    Reset,
    Import,
    Export,
    Migrate,
}

/// Audit trail record for configuration mutations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginConfigAuditRecord {
    pub timestamp: u64,
    pub plugin_name: String,
    pub action: PluginConfigAction,
    pub old_version: u32,
    pub new_version: u32,
    pub old_checksum: String,
    pub new_checksum: String,
    pub success: bool,
    pub error_message: Option<String>,
}

/// Trait for auditing configuration changes.
pub trait PluginConfigAuditor: std::fmt::Debug + Send + Sync {
    fn record(&self, audit: PluginConfigAuditRecord);
}

/// In-memory auditor collector for testing and observation.
#[derive(Debug, Default)]
pub struct MemoryAuditor {
    records: std::sync::Mutex<Vec<PluginConfigAuditRecord>>,
}

impl MemoryAuditor {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn records(&self) -> Vec<PluginConfigAuditRecord> {
        self.records.lock().unwrap().clone()
    }
}

impl PluginConfigAuditor for MemoryAuditor {
    fn record(&self, audit: PluginConfigAuditRecord) {
        if let Ok(mut guard) = self.records.lock() {
            guard.push(audit);
        }
    }
}

/// Configuration change events broadcasted across the engine/UI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PluginConfigEvent {
    ConfigUpdated {
        plugin_name: String,
        version: u32,
        checksum: String,
    },
    ConfigReset {
        plugin_name: String,
    },
    ConfigMigrated {
        plugin_name: String,
        old_version: u32,
        new_version: u32,
    },
    ConfigValidationFailed {
        plugin_name: String,
        errors: Vec<String>,
    },
    ConfigPersisted {
        plugin_name: String,
    },
}

/// Persistence contract for storing plugin configuration.
pub trait PluginConfigStorage: std::fmt::Debug + Send + Sync {
    fn load_config(&self, plugin_name: &str) -> CoreResult<Option<(u32, serde_json::Value)>>;
    fn save_config(
        &self,
        plugin_name: &str,
        version: u32,
        config: &serde_json::Value,
    ) -> CoreResult<()>;
    fn delete_config(&self, plugin_name: &str) -> CoreResult<()>;
}

/// In-memory implementation of [`PluginConfigStorage`].
#[derive(Debug, Default)]
pub struct MemoryConfigStorage {
    data: std::sync::Mutex<HashMap<String, (u32, serde_json::Value)>>,
}

impl MemoryConfigStorage {
    pub fn new() -> Self {
        Self::default()
    }
}

impl PluginConfigStorage for MemoryConfigStorage {
    fn load_config(&self, plugin_name: &str) -> CoreResult<Option<(u32, serde_json::Value)>> {
        let guard = self.data.lock().unwrap();
        Ok(guard.get(plugin_name).cloned())
    }

    fn save_config(
        &self,
        plugin_name: &str,
        version: u32,
        config: &serde_json::Value,
    ) -> CoreResult<()> {
        let mut guard = self.data.lock().unwrap();
        guard.insert(plugin_name.to_string(), (version, config.clone()));
        Ok(())
    }

    fn delete_config(&self, plugin_name: &str) -> CoreResult<()> {
        let mut guard = self.data.lock().unwrap();
        guard.remove(plugin_name);
        Ok(())
    }
}

/// JSON file storage provider for local desktop deployments.
#[derive(Debug)]
pub struct JsonFileConfigStorage {
    file_path: PathBuf,
}

impl JsonFileConfigStorage {
    pub fn new(file_path: PathBuf) -> Self {
        Self { file_path }
    }

    fn read_all(&self) -> HashMap<String, (u32, serde_json::Value)> {
        if let Ok(bytes) = std::fs::read(&self.file_path) {
            serde_json::from_slice(&bytes).unwrap_or_default()
        } else {
            HashMap::new()
        }
    }

    fn write_all(&self, data: &HashMap<String, (u32, serde_json::Value)>) -> CoreResult<()> {
        if let Some(parent) = self.file_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let bytes = serde_json::to_vec_pretty(data)
            .map_err(|e| netpulse_core::NpError::Storage(e.to_string()))?;
        std::fs::write(&self.file_path, bytes)
            .map_err(|e| netpulse_core::NpError::Storage(e.to_string()))
    }
}

impl PluginConfigStorage for JsonFileConfigStorage {
    fn load_config(&self, plugin_name: &str) -> CoreResult<Option<(u32, serde_json::Value)>> {
        let data = self.read_all();
        Ok(data.get(plugin_name).cloned())
    }

    fn save_config(
        &self,
        plugin_name: &str,
        version: u32,
        config: &serde_json::Value,
    ) -> CoreResult<()> {
        let mut data = self.read_all();
        data.insert(plugin_name.to_string(), (version, config.clone()));
        self.write_all(&data)
    }

    fn delete_config(&self, plugin_name: &str) -> CoreResult<()> {
        let mut data = self.read_all();
        data.remove(plugin_name);
        self.write_all(&data)
    }
}

/// Compute SHA256 checksum of canonical JSON for change detection and auditing.
pub fn compute_json_checksum(val: &serde_json::Value) -> String {
    let canonical = serde_json::to_string(val).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    hex_encode(&hasher.finalize())
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// RFC 7396 JSON Merge Patch implementation.
pub fn apply_json_merge_patch(target: &mut serde_json::Value, patch: &serde_json::Value) {
    if let serde_json::Value::Object(patch_obj) = patch {
        if !target.is_object() {
            *target = serde_json::Value::Object(serde_json::Map::new());
        }
        let target_obj = target.as_object_mut().unwrap();
        for (key, value) in patch_obj {
            if value.is_null() {
                target_obj.remove(key);
            } else if value.is_object() {
                let target_child = target_obj
                    .entry(key.clone())
                    .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
                apply_json_merge_patch(target_child, value);
            } else {
                target_obj.insert(key.clone(), value.clone());
            }
        }
    } else {
        *target = patch.clone();
    }
}

/// Manager orchestrating validation, patch, storage, rollbacks, and event auditing.
#[derive(Debug)]
pub struct PluginConfigManager {
    storage: Box<dyn PluginConfigStorage>,
    auditor: Option<Arc<dyn PluginConfigAuditor>>,
    configs: HashMap<String, (u32, serde_json::Value)>,
}

impl Default for PluginConfigManager {
    fn default() -> Self {
        Self {
            storage: Box::new(MemoryConfigStorage::new()),
            auditor: None,
            configs: HashMap::new(),
        }
    }
}

impl PluginConfigManager {
    pub fn new(
        storage: Box<dyn PluginConfigStorage>,
        auditor: Option<Arc<dyn PluginConfigAuditor>>,
    ) -> Self {
        Self {
            storage,
            auditor,
            configs: HashMap::new(),
        }
    }

    /// Validate JSON configuration against a [`JsonSchema`] (validating properties, types, range bounds).
    pub fn validate_schema(
        &self,
        schema: &JsonSchema,
        config: &serde_json::Value,
    ) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();
        let schema_obj = match schema.0.as_object() {
            Some(obj) => obj,
            None => return Ok(()),
        };

        if let Some(required) = schema_obj.get("required").and_then(|r| r.as_array()) {
            for req in required {
                if let Some(req_name) = req.as_str() {
                    if config.get(req_name).is_none() {
                        errors.push(format!("Missing required property '{req_name}'"));
                    }
                }
            }
        }

        if let Some(properties) = schema_obj.get("properties").and_then(|p| p.as_object()) {
            if let Some(config_obj) = config.as_object() {
                for (prop_name, prop_val) in config_obj {
                    if let Some(prop_schema) = properties.get(prop_name).and_then(|s| s.as_object())
                    {
                        if let Some(expected_type) =
                            prop_schema.get("type").and_then(|t| t.as_str())
                        {
                            let type_valid = match expected_type {
                                "string" => prop_val.is_string(),
                                "integer" => prop_val.is_i64() || prop_val.is_u64(),
                                "number" => prop_val.is_number(),
                                "boolean" => prop_val.is_boolean(),
                                "array" => prop_val.is_array(),
                                "object" => prop_val.is_object(),
                                _ => true,
                            };
                            if !type_valid {
                                errors.push(format!(
                                    "Property '{prop_name}' expected type '{expected_type}' but got invalid type"
                                ));
                            }
                        }

                        if let Some(num) = prop_val.as_f64() {
                            if let Some(min) = prop_schema.get("minimum").and_then(|m| m.as_f64()) {
                                if num < min {
                                    errors.push(format!(
                                        "Property '{prop_name}' value {num} is below minimum {min}"
                                    ));
                                }
                            }
                            if let Some(max) = prop_schema.get("maximum").and_then(|m| m.as_f64()) {
                                if num > max {
                                    errors.push(format!(
                                        "Property '{prop_name}' value {num} exceeds maximum {max}"
                                    ));
                                }
                            }
                        }
                    }
                }
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    /// Register and load configuration for a plugin, merging persisted user settings if available.
    pub fn initialize_plugin_config(
        &mut self,
        plugin_name: &str,
        manifest_version: u32,
        default_config: serde_json::Value,
        schema: Option<&JsonSchema>,
    ) -> serde_json::Value {
        let loaded = self.storage.load_config(plugin_name).ok().flatten();
        let (version, config) = match loaded {
            Some((v, cfg)) => {
                if let Some(s) = schema {
                    if self.validate_schema(s, &cfg).is_ok() {
                        (v, cfg)
                    } else {
                        (manifest_version, default_config.clone())
                    }
                } else {
                    (v, cfg)
                }
            }
            None => (manifest_version, default_config.clone()),
        };

        self.configs
            .insert(plugin_name.to_string(), (version, config.clone()));
        config
    }

    /// Get current configuration for a plugin.
    pub fn get_config(&self, plugin_name: &str) -> Option<(u32, serde_json::Value)> {
        self.configs.get(plugin_name).cloned()
    }

    /// Fully update a plugin's configuration with validation, 2-phase commit, and atomic rollback.
    pub fn configure(
        &mut self,
        plugin_name: &str,
        config_version: u32,
        new_config: serde_json::Value,
        schema: Option<&JsonSchema>,
    ) -> Result<(), String> {
        if let Some(s) = schema {
            if let Err(errs) = self.validate_schema(s, &new_config) {
                return Err(format!("Schema validation failed: {}", errs.join("; ")));
            }
        }

        let old_state = self.configs.get(plugin_name).cloned();
        let (old_version, old_config) = old_state
            .clone()
            .unwrap_or((config_version, serde_json::Value::Null));
        let old_checksum = compute_json_checksum(&old_config);
        let new_checksum = compute_json_checksum(&new_config);

        // Update in-memory state
        self.configs.insert(
            plugin_name.to_string(),
            (config_version, new_config.clone()),
        );

        // Attempt persistence
        if let Err(err) = self
            .storage
            .save_config(plugin_name, config_version, &new_config)
        {
            // Rollback in-memory state on persistence failure
            if let Some(prev) = old_state {
                self.configs.insert(plugin_name.to_string(), prev);
            } else {
                self.configs.remove(plugin_name);
            }

            self.record_audit(PluginConfigAuditRecord {
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
                plugin_name: plugin_name.to_string(),
                action: PluginConfigAction::Configure,
                old_version,
                new_version: config_version,
                old_checksum: old_checksum.clone(),
                new_checksum: new_checksum.clone(),
                success: false,
                error_message: Some(err.to_string()),
            });

            return Err(format!(
                "Failed to persist config to storage (rolled back): {err}"
            ));
        }

        self.record_audit(PluginConfigAuditRecord {
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            plugin_name: plugin_name.to_string(),
            action: PluginConfigAction::Configure,
            old_version,
            new_version: config_version,
            old_checksum,
            new_checksum,
            success: true,
            error_message: None,
        });

        Ok(())
    }

    /// RFC 7396 JSON Merge Patch update with optimistic concurrency control (`expected_version`).
    pub fn patch(
        &mut self,
        plugin_name: &str,
        expected_version: Option<u32>,
        patch: serde_json::Value,
        schema: Option<&JsonSchema>,
    ) -> Result<serde_json::Value, String> {
        let (curr_version, mut curr_config) = self
            .configs
            .get(plugin_name)
            .cloned()
            .ok_or_else(|| format!("Plugin '{plugin_name}' is not registered"))?;

        if let Some(exp) = expected_version {
            if exp != curr_version {
                return Err(format!(
                    "Optimistic concurrency mismatch: expected version {exp}, current version is {curr_version}"
                ));
            }
        }

        apply_json_merge_patch(&mut curr_config, &patch);

        self.configure(plugin_name, curr_version, curr_config.clone(), schema)?;
        Ok(curr_config)
    }

    /// Reset plugin configuration back to defaults.
    pub fn reset(
        &mut self,
        plugin_name: &str,
        default_config: serde_json::Value,
    ) -> Result<(), String> {
        let curr_version = self.configs.get(plugin_name).map(|(v, _)| *v).unwrap_or(1);
        self.configure(plugin_name, curr_version, default_config, None)?;

        self.record_audit(PluginConfigAuditRecord {
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            plugin_name: plugin_name.to_string(),
            action: PluginConfigAction::Reset,
            old_version: curr_version,
            new_version: curr_version,
            old_checksum: "".into(),
            new_checksum: "".into(),
            success: true,

            error_message: None,
        });

        Ok(())
    }

    fn record_audit(&self, record: PluginConfigAuditRecord) {
        if let Some(auditor) = &self.auditor {
            auditor.record(record);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_validation_enforces_required_and_range() {
        let manager = PluginConfigManager::default();
        let schema = JsonSchema::new(serde_json::json!({
            "required": ["threshold"],
            "properties": {
                "threshold": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100
                }
            }
        }));

        let valid = serde_json::json!({ "threshold": 10 });
        assert!(manager.validate_schema(&schema, &valid).is_ok());

        let invalid_range = serde_json::json!({ "threshold": 500 });
        assert!(manager.validate_schema(&schema, &invalid_range).is_err());

        let missing_req = serde_json::json!({ "other": 1 });
        assert!(manager.validate_schema(&schema, &missing_req).is_err());
    }

    #[test]
    fn merge_patch_updates_fields_correctly() {
        let mut target = serde_json::json!({ "a": 1, "b": 2 });
        let patch = serde_json::json!({ "b": 3, "c": 4 });
        apply_json_merge_patch(&mut target, &patch);
        assert_eq!(target, serde_json::json!({ "a": 1, "b": 3, "c": 4 }));
    }

    #[test]
    fn configure_rolls_back_if_storage_fails() {
        #[derive(Debug)]
        struct FailingStorage;
        impl PluginConfigStorage for FailingStorage {
            fn load_config(&self, _: &str) -> CoreResult<Option<(u32, serde_json::Value)>> {
                Ok(None)
            }
            fn save_config(&self, _: &str, _: u32, _: &serde_json::Value) -> CoreResult<()> {
                Err(netpulse_core::NpError::Storage("disk full".into()))
            }
            fn delete_config(&self, _: &str) -> CoreResult<()> {
                Ok(())
            }
        }

        let mut manager = PluginConfigManager::new(Box::new(FailingStorage), None);
        manager.initialize_plugin_config("p1", 1, serde_json::json!({"x": 1}), None);

        let res = manager.configure("p1", 1, serde_json::json!({"x": 99}), None);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("rolled back"));

        // Verify in-memory state reverted back to {"x": 1}
        let (_, cfg) = manager.get_config("p1").unwrap();
        assert_eq!(cfg, serde_json::json!({"x": 1}));
    }
}
