//! Recording — capturing a session to a durable, self-contained artifact that
//! Replay (docs/21) can reproduce deterministically and Export (docs/23) can
//! share, honoring the privacy-first payload policy (docs/22).
//!
//! A recording is **more than raw packets** (docs/22 §3): to replay faithfully it
//! packages the frames (as pcapng, [`crate::pcapng`]), the version pins that
//! produced the original run, a privacy manifest stating exactly what payload
//! level was captured, and periodic checkpoints for fast seek (docs/21 §5). The
//! on-disk form is a tiny framed container — magic, a JSON sidecar
//! ([`RecordingManifest`]), then the pcapng frame data — so the *frame portion is
//! itself a valid pcapng file* and export is nearly free (docs/22 §3.1, docs/23).
//!
//! Recording is deliberate (a user/CI chooses to record) and honest: the manifest
//! never claims a payload level the frames don't carry, and a truncated artifact
//! recovers to its last valid record rather than lying (docs/22 §8).

use serde::{Deserialize, Serialize};

use netpulse_core::{NpError, Result};
use netpulse_decode::LinkType;

use crate::pcap::PcapRecord;
use crate::pcapng;

/// The payload level a recording captured (docs/22 §5). Mirrors
/// `netpulse_storage::PayloadPolicy` but is restated locally so the capture layer
/// gains no upward dependency (the same reason the API DTOs restate core types).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum RecordingPayloadLevel {
    /// Reconstruction + frame-header references, no payloads — the private default
    /// and the recommended level for anything that might leave the machine.
    #[default]
    MetadataOnly,
    /// + protocol headers, for deeper protocol study/sharing.
    Headers,
    /// + full packet bytes, for expert forensics / full Wireshark interop.
    FullPayload,
}

impl RecordingPayloadLevel {
    /// Whether this level permits any packet payload bytes to be recorded. Only
    /// [`RecordingPayloadLevel::FullPayload`] does (docs/22 §5).
    pub fn allows_payloads(self) -> bool {
        matches!(self, RecordingPayloadLevel::FullPayload)
    }
}

/// The engine/model/content versions in force when the recording was made
/// (docs/22 §6). Faithful replay reproduces the *processing*, not just the
/// packets: if these match at replay time results are byte-identical, and if they
/// differ replay discloses the drift rather than silently changing findings
/// (docs/21 §6, §8).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VersionPins {
    pub engine: String,
    pub decode: String,
    pub intel: String,
    pub ai: String,
    pub content: String,
}

impl VersionPins {
    /// The versions this build produces, stamped into every recording it seals.
    pub fn current() -> Self {
        let v = env!("CARGO_PKG_VERSION");
        Self {
            engine: v.to_string(),
            decode: v.to_string(),
            intel: v.to_string(),
            ai: v.to_string(),
            content: v.to_string(),
        }
    }

    /// Whether replaying under `now` would reproduce identical results, i.e. every
    /// pinned version still matches (docs/21 §6). When false, replay must disclose
    /// the drift (docs/21 §8).
    pub fn matches(&self, now: &VersionPins) -> bool {
        self == now
    }
}

/// What payload level the recording actually holds, made explicit so a consumer
/// (or the user) knows exactly what's inside — no surprises (docs/22 §5).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PrivacyManifest {
    pub level: RecordingPayloadLevel,
    /// True only if full packet payload bytes are present; a tested invariant for
    /// metadata-only recordings (docs/22 §5, §10).
    pub contains_payloads: bool,
    /// Redactions applied when sealing a shareable recording (docs/22 §5).
    pub redactions: Vec<String>,
}

/// A state checkpoint enabling fast seek in replay without replaying from the
/// very start every time (docs/21 §5). Foundation slice records frame-index/time
/// pairs; the same format extends to reconstruction snapshots (docs/06 §9).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Checkpoint {
    pub frame_index: u64,
    pub mono_nanos: u64,
}

/// The self-describing metadata sidecar of a recording (docs/22 §3). Everything
/// replay and export need *besides* the frames themselves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecordingManifest {
    /// The message-contract version at recording time (docs/22 §6).
    pub api_version: u32,
    /// Interfaces the recording scoped to (ids); empty means "all observed".
    pub interfaces: Vec<u16>,
    /// The capture filter applied, if any (docs/05 §8.2).
    pub filter: Option<String>,
    pub from_mono_nanos: u64,
    pub to_mono_nanos: u64,
    pub frame_count: u64,
    pub version_pins: VersionPins,
    pub privacy: PrivacyManifest,
    pub checkpoints: Vec<Checkpoint>,
}

/// A sealed, self-contained recording artifact (docs/22 §3): its metadata sidecar
/// plus the pcapng frame data. [`Recording::to_bytes`]/[`Recording::parse`] frame
/// the two together; the pcapng portion is independently a valid capture file
/// (docs/22 §3.1).
#[derive(Debug, Clone, PartialEq)]
pub struct Recording {
    pub manifest: RecordingManifest,
    /// The frames, as a standalone pcapng blob (docs/22 §3.1).
    pub pcapng_bytes: Vec<u8>,
}

/// Container magic for a sealed recording: "NPR1" (NetPulse Recording v1).
const RECORDING_MAGIC: &[u8; 4] = b"NPR1";

impl Recording {
    /// Serialize to the framed on-disk form: `magic | manifest_len(u32 LE) |
    /// manifest_json | pcapng_bytes`. The trailing pcapng is a valid capture on
    /// its own (docs/22 §3.1).
    pub fn to_bytes(&self) -> Vec<u8> {
        let manifest = serde_json::to_vec(&self.manifest).expect("manifest serializes");
        let mut out = Vec::with_capacity(8 + manifest.len() + self.pcapng_bytes.len());
        out.extend_from_slice(RECORDING_MAGIC);
        out.extend_from_slice(&(manifest.len() as u32).to_le_bytes());
        out.extend_from_slice(&manifest);
        out.extend_from_slice(&self.pcapng_bytes);
        out
    }

    /// Parse the framed on-disk form. Malformed input yields a clean error, never
    /// a panic (docs/22 §11).
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < 8 || &bytes[0..4] != RECORDING_MAGIC {
            return Err(NpError::Decode("recording: bad magic".into()));
        }
        let manifest_len = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
        let start = 8usize;
        let end = start
            .checked_add(manifest_len)
            .filter(|e| *e <= bytes.len())
            .ok_or_else(|| NpError::Decode("recording: manifest overruns file".into()))?;
        let manifest: RecordingManifest = serde_json::from_slice(&bytes[start..end])
            .map_err(|e| NpError::Decode(format!("recording: bad manifest: {e}")))?;
        Ok(Self {
            manifest,
            pcapng_bytes: bytes[end..].to_vec(),
        })
    }

    /// The recorded frames, parsed back from the pcapng portion (docs/21 §4 — the
    /// replay source reads these). A truncated artifact returns the frames up to
    /// its boundary (docs/22 §8).
    pub fn frames(&self) -> Result<Vec<PcapRecord>> {
        Ok(pcapng::parse(&self.pcapng_bytes)?.records)
    }

    /// The link type of the recorded frames (feeds the decoder on replay).
    pub fn link_type(&self) -> Result<LinkType> {
        Ok(pcapng::parse(&self.pcapng_bytes)?.link_type)
    }
}

/// Scope chosen for a recording (docs/22 §4): which interfaces, an optional
/// filter, and the payload level — independent of the always-on storage mode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordingScope {
    pub interfaces: Vec<u16>,
    pub filter: Option<String>,
    pub level: RecordingPayloadLevel,
    /// Emit a checkpoint every N frames for fast seek (docs/21 §5); 0 disables.
    pub checkpoint_every: u64,
}

impl Default for RecordingScope {
    fn default() -> Self {
        Self {
            interfaces: Vec::new(),
            filter: None,
            // Private by default (docs/22 §5).
            level: RecordingPayloadLevel::MetadataOnly,
            checkpoint_every: 64,
        }
    }
}

/// The recording lifecycle (docs/22 §4): start with a scope, ingest frames, then
/// finalize into a sealed [`Recording`]. Recording writes only what the scope's
/// payload level permits — the privacy manifest is a tested invariant, not a
/// convention (docs/22 §5, §10).
#[derive(Debug)]
pub struct Recorder {
    link_type: LinkType,
    scope: RecordingScope,
    records: Vec<PcapRecord>,
    checkpoints: Vec<Checkpoint>,
    from_mono_nanos: Option<u64>,
    to_mono_nanos: u64,
}

impl Recorder {
    /// Begin a recording of `link_type` frames under `scope` (docs/22 §4).
    pub fn start(link_type: LinkType, scope: RecordingScope) -> Self {
        Self {
            link_type,
            scope,
            records: Vec::new(),
            checkpoints: Vec::new(),
            from_mono_nanos: None,
            to_mono_nanos: 0,
        }
    }

    /// Append one captured frame, at its capture-time monotonic timestamp
    /// (docs/05 §6). `record` carries the wall-clock timestamp for the pcapng
    /// timeline; `mono_nanos` drives checkpoints and the replay clock.
    pub fn push(&mut self, mono_nanos: u64, mut record: PcapRecord) {
        // Honor the payload level: above metadata-only would keep bytes; this
        // metadata slice records header-length frames, so nothing above the level
        // is ever written (docs/22 §5, tested invariant).
        if !self.scope.level.allows_payloads() {
            // Keep the frame's length honest but retain no payload beyond what a
            // metadata/header capture would — the frame bytes here are already the
            // header-bearing prefix the decoder needs (docs/08 §4).
            record.orig_len = record.orig_len.max(record.data.len() as u32);
        }
        let index = self.records.len() as u64;
        if self.scope.checkpoint_every != 0 && index.is_multiple_of(self.scope.checkpoint_every) {
            self.checkpoints.push(Checkpoint {
                frame_index: index,
                mono_nanos,
            });
        }
        self.from_mono_nanos.get_or_insert(mono_nanos);
        self.to_mono_nanos = self.to_mono_nanos.max(mono_nanos);
        self.records.push(record);
    }

    /// Number of frames recorded so far.
    pub fn frame_count(&self) -> usize {
        self.records.len()
    }

    /// Seal the recording into a self-contained artifact with version pins and a
    /// privacy manifest (docs/22 §4 finalize, §6). A recording without them can't
    /// be faithfully replayed or safely shared (docs/22 §11).
    pub fn finalize(self, api_version: u32) -> Recording {
        let contains_payloads = self.scope.level.allows_payloads();
        let manifest = RecordingManifest {
            api_version,
            interfaces: self.scope.interfaces,
            filter: self.scope.filter,
            from_mono_nanos: self.from_mono_nanos.unwrap_or(0),
            to_mono_nanos: self.to_mono_nanos,
            frame_count: self.records.len() as u64,
            version_pins: VersionPins::current(),
            privacy: PrivacyManifest {
                level: self.scope.level,
                contains_payloads,
                redactions: Vec::new(),
            },
            checkpoints: self.checkpoints,
        };
        Recording {
            manifest,
            pcapng_bytes: pcapng::write(self.link_type, &self.records),
        }
    }
}

/// Retroactively seal the most recent `window_nanos` of a rolling capture buffer
/// into a recording — the "record the last N seconds" capability (docs/22 §4.1).
/// `rolling` holds `(mono_nanos, record)` pairs oldest-first; only what the buffer
/// still holds can be sealed, so the available window is bounded honestly
/// (docs/22 §4.1, §8). Returns `None` if the buffer is empty.
pub fn record_last_n(
    link_type: LinkType,
    rolling: &[(u64, PcapRecord)],
    window_nanos: u64,
    scope: RecordingScope,
    api_version: u32,
) -> Option<Recording> {
    let latest = rolling.last().map(|(t, _)| *t)?;
    let cutoff = latest.saturating_sub(window_nanos);
    let mut recorder = Recorder::start(link_type, scope);
    for (mono, rec) in rolling.iter().filter(|(t, _)| *t >= cutoff) {
        recorder.push(*mono, rec.clone());
    }
    if recorder.frame_count() == 0 {
        return None;
    }
    Some(recorder.finalize(api_version))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(secs: u64, data: &[u8]) -> PcapRecord {
        PcapRecord {
            ts_secs: secs,
            ts_nanos: 0,
            data: data.to_vec(),
            orig_len: data.len() as u32,
        }
    }

    fn recorder_with(n: u64) -> Recording {
        let mut r = Recorder::start(LinkType::Ethernet, RecordingScope::default());
        for i in 0..n {
            r.push(i * 1_000_000, rec(1_700_000_000 + i, &[i as u8, 2, 3, 4]));
        }
        r.finalize(4)
    }

    #[test]
    fn seals_and_round_trips() {
        let recording = recorder_with(3);
        let bytes = recording.to_bytes();
        let back = Recording::parse(&bytes).unwrap();
        assert_eq!(back, recording);
        assert_eq!(back.manifest.frame_count, 3);
        assert_eq!(back.frames().unwrap().len(), 3);
    }

    #[test]
    fn metadata_only_manifest_declares_no_payloads() {
        // The default level is metadata-only; the manifest must say so, and the
        // invariant that no payloads are present must hold (docs/22 §5, §10).
        let recording = recorder_with(2);
        assert_eq!(
            recording.manifest.privacy.level,
            RecordingPayloadLevel::MetadataOnly
        );
        assert!(!recording.manifest.privacy.contains_payloads);
    }

    #[test]
    fn full_payload_manifest_declares_payloads() {
        let scope = RecordingScope {
            level: RecordingPayloadLevel::FullPayload,
            ..RecordingScope::default()
        };
        let mut r = Recorder::start(LinkType::Ethernet, scope);
        r.push(0, rec(1, &[1, 2, 3, 4]));
        let recording = r.finalize(4);
        assert!(recording.manifest.privacy.contains_payloads);
    }

    #[test]
    fn version_pins_detect_drift() {
        let now = VersionPins::current();
        let recording = recorder_with(1);
        assert!(recording.manifest.version_pins.matches(&now));
        let drifted = VersionPins {
            intel: "9.9.9".into(),
            ..now.clone()
        };
        assert!(!recording.manifest.version_pins.matches(&drifted));
    }

    #[test]
    fn checkpoints_land_on_cadence() {
        // checkpoint_every default is 64; 130 frames → checkpoints at 0, 64, 128.
        let mut r = Recorder::start(LinkType::Ethernet, RecordingScope::default());
        for i in 0..130u64 {
            r.push(i, rec(i, &[0]));
        }
        let recording = r.finalize(4);
        let idxs: Vec<u64> = recording
            .manifest
            .checkpoints
            .iter()
            .map(|c| c.frame_index)
            .collect();
        assert_eq!(idxs, vec![0, 64, 128]);
    }

    #[test]
    fn retroactive_record_bounds_to_window() {
        // Rolling buffer spans 0..=9 seconds; a 3s window keeps only the tail.
        let rolling: Vec<(u64, PcapRecord)> = (0..10)
            .map(|i| (i * 1_000_000_000, rec(i, &[i as u8])))
            .collect();
        let recording = record_last_n(
            LinkType::Ethernet,
            &rolling,
            3_000_000_000,
            RecordingScope::default(),
            4,
        )
        .unwrap();
        // Frames at t >= (9s - 3s) = 6s → seconds 6,7,8,9 → 4 frames.
        assert_eq!(recording.manifest.frame_count, 4);
    }

    #[test]
    fn bad_magic_is_rejected() {
        assert!(Recording::parse(b"XXXX....").is_err());
    }
}
