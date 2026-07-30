//! Decoupled Provider & Extension Traits.

use std::sync::Arc;

pub trait Codec: Send + Sync {
    fn name(&self) -> &'static str;
    fn encode(&self, item: &serde_json::Value) -> Result<Vec<u8>, String>;
    fn decode(&self, buf: &[u8]) -> Result<serde_json::Value, String>;
}

pub struct ProviderRegistry {
    pub codecs: Vec<Arc<dyn Codec>>,
}

impl Default for ProviderRegistry {
    fn default() -> Self {
        Self { codecs: Vec::new() }
    }
}
impl std::fmt::Debug for ProviderRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProviderRegistry")
            .field("codecs_count", &self.codecs.len())
            .finish()
    }
}
