// Replay — deterministic re-processing of a recorded session (docs/21). Replay
// reruns the *same* capture→decode→flow→narrative→intelligence pipeline over
// stored data to produce identical results every time (docs/21 §1, §4). It
// decouples processing from wall-clock, so a handshake can be watched at 0.1×,
// stepped packet-by-packet, or seeked to any instant (docs/21 §5). Determinism is
// a hard guarantee: timing comes from the recording, never `now()` (docs/21 §6).
// With no recording loaded, the transport is honest about having nothing to play.

import { useEffect, useState } from "react";
import type { ReplayState } from "@netpulse/contract";
import { query, command } from "../ipc";

const SPEEDS: Array<{ label: string; percent: number }> = [
  { label: "0.1× (teach)", percent: 10 },
  { label: "1×", percent: 100 },
  { label: "10× (skim)", percent: 1000 },
];

function ms(ns: number): string {
  return `${(ns / 1_000_000).toFixed(1)} ms`;
}

export function Replay() {
  const [state, setState] = useState<ReplayState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function refresh() {
    query({ kind: "replayState" })
      .then((res) => setState(res.kind === "replayState" ? res.state : null))
      .catch(() => setState(null));
  }

  useEffect(refresh, []);

  async function send(c: Parameters<typeof command>[0]) {
    setNotice(null);
    try {
      await command(c);
      refresh();
    } catch (e) {
      setNotice(String(e));
    }
  }

  const loaded = !!state && state.total_nanos > 0;

  return (
    <section className="np-replay" aria-label="Replay">
      <p className="np-replay__note">
        Replay reuses the exact live pipeline — one pipeline, two sources — so what
        you see is precisely what the engine did. It reconstructs byte-identically
        every run (docs/21 §4, §6).
      </p>

      {/* Transport: play / pause / step (docs/21 §5). */}
      <div className="np-replay__transport" role="group" aria-label="Playback">
        <button className="np-btn" onClick={() => void send({ kind: "replayPause" })}>
          Pause
        </button>
        <button className="np-btn" onClick={() => void send({ kind: "replayPlay" })}>
          Play
        </button>
        <button className="np-btn" onClick={() => void send({ kind: "replayStep" })}>
          Step ›
        </button>
        <div className="np-replay__speeds">
          {SPEEDS.map((s) => (
            <button
              key={s.percent}
              className={
                state?.speed_percent === s.percent ? "np-btn np-btn--active" : "np-btn"
              }
              onClick={() => void send({ kind: "replaySetSpeed", percent: s.percent })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Seek — reconstructs correct state as of any instant (docs/21 §5). */}
      <input
        className="np-replay__seek"
        type="range"
        min={0}
        max={state?.total_nanos ?? 0}
        value={state?.position_nanos ?? 0}
        aria-label="Seek"
        disabled={!loaded}
        onChange={(e) => void send({ kind: "replaySeek", mono_nanos: Number(e.target.value) })}
      />

      <div className="np-replay__readout">
        <span>
          {ms(state?.position_nanos ?? 0)} / {ms(state?.total_nanos ?? 0)}
        </span>
        <span>frame #{state?.frame_index ?? 0}</span>
        <span>{state?.playing ? "playing" : "paused"}</span>
        <span>{(state?.speed_percent ?? 100) / 100}×</span>
        {state?.incomplete && (
          // Gaps/truncation replayed as gaps, honestly (docs/21 §8).
          <span className="np-replay__incomplete">recording incomplete</span>
        )}
      </div>

      {notice && <p className="np-replay__notice">{notice}</p>}
      {!loaded && (
        <div className="np-empty">
          No recording loaded to replay. Make a recording, then step through it —
          the same session, every time.
        </div>
      )}
    </section>
  );
}
