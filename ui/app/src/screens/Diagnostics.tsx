import { useTranslation } from "react-i18next";
import { Button, Input, Notice, Skeleton } from "@netpulse/components";
import { useDiagnosticsController } from "../hooks/useDiagnosticsController";
import { PingResultCard } from "./Diagnostics/PingResultCard";
import { TracerouteCard } from "./Diagnostics/TracerouteCard";
import { BufferbloatCard } from "./Diagnostics/BufferbloatCard";
import { EmptyDiagnosticsState } from "./Diagnostics/EmptyDiagnosticsState";

const TARGET_PRESETS = [
  { label: "1.1.1.1 (Cloudflare)", value: "1.1.1.1" },
  { label: "8.8.8.8 (Google)", value: "8.8.8.8" },
  { label: "9.9.9.9 (Quad9)", value: "9.9.9.9" },
  { label: "localhost", value: "localhost" },
];

export function DiagnosticsScreen() {
  const { t } = useTranslation(["diagnostics", "common"]);

  const {
    target,
    setTarget,
    notice,
    setNotice,
    announcement,
    probes,
    busy,
    hasAnyResults,
    isAnyBusy,
    actions,
  } = useDiagnosticsController();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !isAnyBusy) {
      void actions.runPing();
    }
  };

  return (
    <section className="np-diagnostics" aria-label={t("title")}>
      <header style={{ marginBottom: "1.25rem" }}>
        <h1 className="np-hero__title">{t("title")}</h1>
        <p className="np-hero__sub">{t("desc")}</p>
      </header>

      {/* Screen Reader Live Announcement Region */}
      <div className="np-sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {/* Target Validation Notice Banner */}
      {notice && (
        <Notice
          message={notice === "invalid_target" ? t("invalid_target") : notice}
          level="error"
          onDismiss={() => setNotice(null)}
        />
      )}

      {/* Target Quick Presets */}
      <div className="np-diagnostics__presets">
        <span style={{ fontSize: "0.75rem", color: "var(--np-text-mute)", fontWeight: 600 }}>
          Quick Target Presets:
        </span>
        {TARGET_PRESETS.map((p) => (
          <Button
            key={p.value}
            variant={target === p.value ? "primary" : "standard"}
            onClick={() => setTarget(p.value)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {/* Target Input & Probe Action Buttons */}
      <div className="np-diagnostics__actions" style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <div style={{ flex: "1 1 260px", minWidth: "220px" }}>
          <Input
            value={target}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTarget(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("target_placeholder")}
            aria-label={t("target_placeholder")}
          />
        </div>
        <Button variant="primary" busy={busy.ping} disabled={isAnyBusy} onClick={() => void actions.runPing()}>
          {t("ping_btn")}
        </Button>
        <Button variant="standard" busy={busy.traceroute} disabled={isAnyBusy} onClick={() => void actions.runTraceroute()}>
          {t("traceroute_btn")}
        </Button>
        <Button variant="standard" busy={busy.bufferbloat} disabled={isAnyBusy} onClick={() => void actions.runBufferbloat()}>
          {t("bufferbloat_btn")}
        </Button>
        {hasAnyResults && (
          <Button variant="standard" onClick={actions.clearResults}>
            ✕ {t("clear_all")}
          </Button>
        )}
      </div>

      {/* Probe Results & Skeletons */}
      {!hasAnyResults && !isAnyBusy && !notice ? (
        <EmptyDiagnosticsState
          target={target}
          onSetTarget={setTarget}
          onRunPing={() => void actions.runPing()}
          onRunTraceroute={() => void actions.runTraceroute()}
          onRunBufferbloat={() => void actions.runBufferbloat()}
        />
      ) : (
        <div aria-live="polite">
          {/* Ping Probe Result & Skeleton */}
          {busy.ping && (
            <Skeleton height={140} width="100%" style={{ marginBottom: "1.5rem", borderRadius: "var(--np-radius-lg)" }} />
          )}
          {probes.ping.result && <PingResultCard result={probes.ping.result} />}

          {/* Traceroute Probe Result & Skeleton */}
          {busy.traceroute && (
            <Skeleton height={180} width="100%" style={{ marginBottom: "1.5rem", borderRadius: "var(--np-radius-lg)" }} />
          )}
          {probes.traceroute.result && (
            <TracerouteCard target={target} hops={probes.traceroute.result} />
          )}

          {/* Bufferbloat Probe Result & Skeleton */}
          {busy.bufferbloat && (
            <Skeleton height={140} width="100%" style={{ marginBottom: "1.5rem", borderRadius: "var(--np-radius-lg)" }} />
          )}
          {probes.bufferbloat.result && (
            <BufferbloatCard target={target} result={probes.bufferbloat.result} />
          )}
        </div>
      )}
    </section>
  );
}
