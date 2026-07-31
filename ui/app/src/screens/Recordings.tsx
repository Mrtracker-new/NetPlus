// Recordings — capturing a session to a durable, self-contained artifact (docs/22).
// A recording packages the frames plus the version pins and a privacy manifest
// needed to replay it faithfully (docs/22 §3, §6) and share it safely (docs/22 §5).
// Recording is deliberate — the user starts it — and honest: the manifest states
// exactly the payload level captured, so there are no surprises about what's
// inside (docs/22 §5). In this build there is no live capture source, so starting
// a recording fails closed rather than sealing an empty artifact (docs/02 §11).

import { useEffect, useState } from "react";
import type { RecordingSummary } from "@netpulse/contract";
import { EmptyState, Notice } from "@netpulse/components";
import { query, command } from "../ipc";

const LEVEL_LABEL: Record<RecordingSummary["privacy"]["level"], string> = {
  metadata_only: "Metadata only",
  headers: "Headers",
  full_payload: "Full payload",
};

function seconds(ns: number): string {
  return `${(ns / 1_000_000_000).toFixed(2)}s`;
}

function RecordingCard({ rec }: { rec: RecordingSummary }) {
  return (
    <article className="np-recording">
      <header className="np-recording__head">
        <span className="np-recording__title">Recording #{rec.id}</span>
        {/* The payload level is always explicit — no surprises (docs/22 §5). */}
        <span className="np-recording__level">{LEVEL_LABEL[rec.privacy.level]}</span>
      </header>

      <div className="np-recording__meta">
        <span>{rec.frame_count} frames</span>
        <span>
          {seconds(rec.from_mono_nanos)} → {seconds(rec.to_mono_nanos)}
        </span>
        {rec.incomplete && (
          // A truncated/recovered recording is marked honestly (docs/21 §8).
          <span className="np-recording__incomplete">incomplete</span>
        )}
      </div>

      {/* The privacy manifest, plainly (docs/22 §5): whether any payloads exist. */}
      <p className="np-recording__privacy">
        {rec.privacy.contains_payloads
          ? "Contains packet payloads."
          : "No packet payloads — safe to share for teaching and bug reports."}
      </p>

      {/* Version pins let replay reproduce the same processing or disclose drift
          (docs/22 §6, docs/21 §8). */}
      <details className="np-recording__pins">
        <summary>Determinism · version pins</summary>
        <ul>
          <li>engine {rec.version_pins.engine}</li>
          <li>decode {rec.version_pins.decode}</li>
          <li>intel {rec.version_pins.intel}</li>
          <li>ai {rec.version_pins.ai}</li>
          <li>content {rec.version_pins.content}</li>
        </ul>
      </details>
    </article>
  );
}

export function Recordings() {
  const [recordings, setRecordings] = useState<RecordingSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function refresh() {
    query({ kind: "listRecordings" })
      .then((res) => setRecordings(res.kind === "recordings" ? res.recordings : []))
      .catch(() => setRecordings([]))
      .finally(() => setLoaded(true));
  }

  useEffect(refresh, []);

  async function record(kind: "startRecording" | "stopRecording") {
    setNotice(null);
    try {
      await command({ kind });
      refresh();
    } catch (e) {
      // Honest failure surfaced to the user (docs/02 §11), never a silent no-op.
      setNotice(String(e));
    }
  }

  return (
    <section className="np-recordings" aria-label="Recordings">
      <div className="np-recordings__controls">
        <button className="np-btn" onClick={() => void record("startRecording")}>
          Start recording
        </button>
        <button className="np-btn" onClick={() => void record("stopRecording")}>
          Stop
        </button>
        <span className="np-recordings__hint">
          Recording is local and deliberate — nothing is uploaded (docs/22 §5).
        </span>
      </div>

      <Notice message={notice} onDismiss={() => setNotice(null)} />

      {loaded && recordings.length === 0 ? (
        <EmptyState>
          No recordings yet. A recording is a self-contained, replayable capture you
          choose to make — with a privacy manifest stating exactly what's inside.
        </EmptyState>
      ) : (
        recordings.map((r) => <RecordingCard key={r.id} rec={r} />)
      )}
    </section>
  );
}
