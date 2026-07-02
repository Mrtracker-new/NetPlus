// Timeline — "what happened, and when?" (docs/10). A set of horizontally-aligned
// tracks sharing one time axis, so anything at the same moment lines up
// vertically (docs/10 §4). This scaffold lays out the track structure; the dense
// GPU rendering (docs/10 §8) lands with the viz package.
//
// The feed cards double as session spans on the Sessions track here — a second
// entry point into the one model, from the time axis rather than the feed
// (docs/10 §6).

import { useStore } from "../state/store";

const TRACKS = ["Throughput", "Applications", "Protocols", "Latency & loss", "Findings", "Sessions"];

export function Timeline() {
  const { feed } = useStore();

  return (
    <section className="np-timeline" aria-label="Timeline">
      {TRACKS.map((track) => (
        <div className="np-track" key={track}>
          <div className="np-track__label">{track}</div>
          <div className="np-track__lane">
            {track === "Sessions" &&
              feed.map((card) => (
                <span
                  className="np-span"
                  key={`${card.at_mono_nanos}-${card.headline}`}
                  title={card.headline}
                >
                  {card.headline}
                </span>
              ))}
          </div>
        </div>
      ))}
    </section>
  );
}
