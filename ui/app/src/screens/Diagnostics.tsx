import { useTranslation } from "react-i18next";
import { Button, Notice, Skeleton } from "@netpulse/components";
import { Icon } from "../icons";
import { useDiagnosticsController } from "../hooks/useDiagnosticsController";
import { PingResultCard } from "./Diagnostics/PingResultCard";
import { TracerouteCard } from "./Diagnostics/TracerouteCard";
import { BufferbloatCard } from "./Diagnostics/BufferbloatCard";
import { DeepDiagnosticCard } from "./Diagnostics/DeepDiagnosticCard";
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
    deepSession,
    deepStage,
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

      {/* Screen Reader Live Announcement Region — isolated for polite announcements */}
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

      {/* Level 1 Raised Surface: Tactile Diagnostic Console Plate */}
      <div className="np-diagnostics-console">
        {/* Quick Target Presets Row */}
        <div className="np-diagnostics__presets" role="group" aria-label={t("quick_presets")}>
          <span style={{ fontSize: "0.75rem", color: "var(--np-text-mute)", fontWeight: 600 }}>
            {t("quick_presets")}
          </span>
          {TARGET_PRESETS.map((p) => {
            const isSelected = target === p.value;
            return (
              <button
                key={p.value}
                type="button"
                className={`np-diagnostics__preset-btn ${
                  isSelected ? "np-diagnostics__preset-btn--active" : ""
                }`}
                aria-pressed={isSelected}
                onClick={() => setTarget(p.value)}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Level 3 Recessed Input Well & Probe Action Hierarchy */}
        <div className="np-diagnostics__actions">
          <div className="np-diagnostics-input-well">
            <Icon name="target" style={{ width: "16px", height: "16px", color: "var(--np-text-mute)", flexShrink: 0 }} />
            <input
              type="text"
              value={target}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTarget(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("target_placeholder")}
              aria-label={t("target_placeholder")}
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          {/* Single Dominant Primary Execution Action */}
          <Button
            variant="primary"
            busy={busy.deep}
            disabled={isAnyBusy}
            onClick={() => void actions.runDeepDiagnostics()}
            aria-label={t("full_analysis_btn")}
          >
            <Icon name="microscope" style={{ width: "14px", height: "14px", marginRight: "4px" }} />
            {t("full_analysis_btn")}
          </Button>

          {/* Secondary Tactile Probe Actions */}
          <Button
            variant="standard"
            busy={busy.ping}
            disabled={isAnyBusy}
            onClick={() => void actions.runPing()}
            aria-label={t("ping_btn")}
          >
            {t("ping_btn")}
          </Button>

          <Button
            variant="standard"
            busy={busy.traceroute}
            disabled={isAnyBusy}
            onClick={() => void actions.runTraceroute()}
            aria-label={t("traceroute_btn")}
          >
            {t("traceroute_btn")}
          </Button>

          <Button
            variant="standard"
            busy={busy.bufferbloat}
            disabled={isAnyBusy}
            onClick={() => void actions.runBufferbloat()}
            aria-label={t("bufferbloat_btn")}
          >
            {t("bufferbloat_btn")}
          </Button>

          {/* Utility Action */}
          {hasAnyResults && (
            <Button
              variant="standard"
              onClick={actions.clearResults}
              className="np-diagnostics-clear-btn"
              aria-label={t("clear_all")}
            >
              <Icon name="close" />
              {t("clear_all")}
            </Button>
          )}
        </div>
      </div>

      {/* Probe Results & Empty State Deck */}
      {!hasAnyResults && !isAnyBusy && !notice ? (
        <EmptyDiagnosticsState
          onRunPing={() => void actions.runPing()}
          onRunTraceroute={() => void actions.runTraceroute()}
          onRunBufferbloat={() => void actions.runBufferbloat()}
          onRunDeepDiagnostics={() => void actions.runDeepDiagnostics()}
          disabled={isAnyBusy}
        />
      ) : (
        <div className="np-diagnostics-results-flow">
          {/* Deep Diagnostic Assessment & Findings */}
          {busy.deep && !deepSession && (
            <Skeleton height={260} width="100%" style={{ marginBottom: "1.5rem", borderRadius: "var(--np-radius-lg)" }} />
          )}
          {deepSession && (
            <DeepDiagnosticCard session={deepSession} activeStage={deepStage} />
          )}

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
