// Timeline — "what happened, and when?" (docs/10). One shared time axis with the
// reconstructed events laned by severity, so anything at the same moment lines up
// vertically (docs/10 §4). The feed cards double as time-positioned marks here — a
// second entry point into the one model, from the time axis rather than the feed
// (docs/10 §6). Dense GPU rendering (docs/10 §8) is a later optimization.

import { useTranslation } from "react-i18next";
import { EmptyState } from "@netpulse/components";
import { useStore } from "../state/store";
import { TimeRibbon } from "@netpulse/viz";
import { useEvidenceNavigation } from "../context/EvidenceNavigationContext";

export function Timeline() {
  const { t } = useTranslation(["timeline", "common"]);
  const { feed } = useStore();
  const { navigationTarget } = useEvidenceNavigation();

  const highlightPacketId =
    navigationTarget?.screen === "timeline" ? navigationTarget.packetId : undefined;
  const highlightTimestamp =
    navigationTarget?.screen === "timeline" ? navigationTarget.timestamp : undefined;

  const events = feed.map((c) => ({
    at: c.at_mono_nanos,
    label: c.headline,
    severity: c.severity,
  }));

  if (events.length === 0) {
    return <EmptyState>{t("empty")}</EmptyState>;
  }

  return (
    <section className="np-timeline" aria-label={t("title")}>
      {navigationTarget?.screen === "timeline" && (
        <div className="np-filter-banner" style={{ marginBottom: "1rem" }} role="status">
          {highlightPacketId !== undefined
            ? t("filter_banner", { packetId: highlightPacketId })
            : t("title")}
        </div>
      )}
      <TimeRibbon
        events={events}
        highlightPacketId={highlightPacketId}
        highlightTimestamp={highlightTimestamp}
      />
    </section>
  );
}

