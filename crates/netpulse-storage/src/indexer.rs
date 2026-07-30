//! Incremental Chunk-Based Session Metric Indexer.

use std::collections::HashMap;

#[derive(Debug, Clone, Default)]
pub struct SessionIndexMetrics {
    pub flow_count: u32,
    pub total_bytes: u64,
    pub avg_rtt_ms: f32,
    pub protocols: HashMap<String, u32>,
}

#[derive(Debug, Default)]
pub struct IncrementalSessionIndexer {
    pub chunk_size: usize,
    pub cached_indexes: HashMap<u64, SessionIndexMetrics>,
}

impl IncrementalSessionIndexer {
    pub fn new(chunk_size: usize) -> Self {
        Self {
            chunk_size,
            cached_indexes: HashMap::new(),
        }
    }

    pub fn index_chunk(
        &mut self,
        session_id: u64,
        flow_count_delta: u32,
        bytes_delta: u64,
        rtt_ms: f32,
        protocol: &str,
    ) {
        let entry = self.cached_indexes.entry(session_id).or_default();
        entry.flow_count += flow_count_delta;
        entry.total_bytes += bytes_delta;
        entry.avg_rtt_ms = (entry.avg_rtt_ms + rtt_ms) / 2.0;
        *entry.protocols.entry(protocol.to_string()).or_insert(0) += flow_count_delta;
    }

    pub fn get_metrics(&self, session_id: u64) -> Option<&SessionIndexMetrics> {
        self.cached_indexes.get(&session_id)
    }
}
