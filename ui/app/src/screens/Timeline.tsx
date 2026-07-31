// Timeline — "what happened, and when?" (docs/10). One shared time axis with the
// reconstructed events laned by severity, so anything at the same moment lines up
// vertically (docs/10 §4). The feed cards double as time-positioned marks here — a
// second entry point into the one model, from the time axis rather than the feed
// (docs/10 §6). Dense GPU rendering (docs/10 §8) is a later optimization.

import { EmptyState } from "@netpulse/components";
import { useStore } from "../state/store";
import { TimeRibbon } from "../viz";

export function Timeline() {
  const { feed } = useStore();
  const events = feed.map((c) => ({
    at: c.at_mono_nanos,
    label: c.headline,
    severity: c.severity,
  }));

  if (events.length === 0) {
    return <EmptyState>Nothing on the timeline yet — it fills as traffic is reconstructed.</EmptyState>;
  }

  return (
    <section className="np-timeline" aria-label="Timeline">
      <TimeRibbon events={events} />
    </section>
  );
}
