import { useTranslation } from "react-i18next";
import { Icon } from "../../icons";

export interface EmptyDiagnosticsStateProps {
  onRunPing?: () => void;
  onRunTraceroute?: () => void;
  onRunBufferbloat?: () => void;
  onRunDeepDiagnostics?: () => void;
  disabled?: boolean;
}

export function EmptyDiagnosticsState({
  onRunPing,
  onRunTraceroute,
  onRunBufferbloat,
  onRunDeepDiagnostics,
  disabled = false,
}: EmptyDiagnosticsStateProps) {
  const { t } = useTranslation(["diagnostics"]);

  return (
    <div className="np-diagnostics__empty">
      <div className="np-diagnostics__empty-icon">
        <Icon name="diagnostics" />
      </div>

      <h3
        style={{
          margin: "0 0 0.4rem 0",
          fontSize: "1.15rem",
          fontWeight: 600,
          color: "var(--np-text)",
        }}
      >
        {t("title")}
      </h3>

      <p
        style={{
          margin: "0 0 1rem 0",
          maxWidth: "56ch",
          fontSize: "0.875rem",
          color: "var(--np-text-dim)",
          lineHeight: 1.5,
        }}
      >
        {t("empty")}
      </p>

      {/* 4-Card Responsive Capability Overview Deck */}
      <div className="np-diagnostics__capabilities" role="region" aria-label={t("capabilities.deck_label")}>
        {/* Card 1: Full Analysis (Deep Pipeline) */}
        <div className="np-diagnostics__capability-card">
          <div className="np-diagnostics__capability-header">
            <div className="np-diagnostics__capability-icon" style={{ background: "var(--np-accent-soft)", color: "var(--np-accent-strong)" }}>
              <Icon name="microscope" />
            </div>
            <div>
              <h4 className="np-diagnostics__capability-title">{t("capabilities.full_analysis.title")}</h4>
              <span style={{ fontSize: "0.72rem", color: "var(--np-text-mute)" }}>{t("capabilities.full_analysis.subtitle")}</span>
            </div>
          </div>
          <p className="np-diagnostics__capability-desc">
            {t("capabilities.full_analysis.desc")}
          </p>
          <div className="np-diagnostics__capability-tags">
            <span className="np-diagnostics__capability-tag">{t("capabilities.full_analysis.tag_root")}</span>
            <span className="np-diagnostics__capability-tag">{t("capabilities.full_analysis.tag_remediation")}</span>
            <span className="np-diagnostics__capability-tag">{t("capabilities.full_analysis.tag_confidence")}</span>
          </div>
          {onRunDeepDiagnostics && (
            <button
              type="button"
              className="np-diagnostics__capability-btn"
              disabled={disabled}
              onClick={onRunDeepDiagnostics}
              aria-label={t("capabilities.full_analysis.btn")}
            >
              <Icon name="microscope" style={{ width: "12px", height: "12px" }} />
              {t("capabilities.full_analysis.btn")}
            </button>
          )}
        </div>

        {/* Card 2: Ping Probe */}
        <div className="np-diagnostics__capability-card">
          <div className="np-diagnostics__capability-header">
            <div className="np-diagnostics__capability-icon">
              <Icon name="radio" />
            </div>
            <div>
              <h4 className="np-diagnostics__capability-title">{t("capabilities.ping.title")}</h4>
              <span style={{ fontSize: "0.72rem", color: "var(--np-text-mute)" }}>{t("capabilities.ping.subtitle")}</span>
            </div>
          </div>
          <p className="np-diagnostics__capability-desc">
            {t("capabilities.ping.desc")}
          </p>
          <div className="np-diagnostics__capability-tags">
            <span className="np-diagnostics__capability-tag">{t("capabilities.ping.tag_rtt")}</span>
            <span className="np-diagnostics__capability-tag">{t("capabilities.ping.tag_jitter")}</span>
            <span className="np-diagnostics__capability-tag">{t("capabilities.ping.tag_loss")}</span>
          </div>
          {onRunPing && (
            <button
              type="button"
              className="np-diagnostics__capability-btn"
              disabled={disabled}
              onClick={onRunPing}
              aria-label={t("capabilities.ping.btn")}
            >
              <Icon name="radio" style={{ width: "12px", height: "12px" }} />
              {t("capabilities.ping.btn")}
            </button>
          )}
        </div>

        {/* Card 3: Traceroute */}
        <div className="np-diagnostics__capability-card">
          <div className="np-diagnostics__capability-header">
            <div className="np-diagnostics__capability-icon">
              <Icon name="timeline" />
            </div>
            <div>
              <h4 className="np-diagnostics__capability-title">{t("capabilities.traceroute.title")}</h4>
              <span style={{ fontSize: "0.72rem", color: "var(--np-text-mute)" }}>{t("capabilities.traceroute.subtitle")}</span>
            </div>
          </div>
          <p className="np-diagnostics__capability-desc">
            {t("capabilities.traceroute.desc")}
          </p>
          <div className="np-diagnostics__capability-tags">
            <span className="np-diagnostics__capability-tag">{t("capabilities.traceroute.tag_ttl")}</span>
            <span className="np-diagnostics__capability-tag">{t("capabilities.traceroute.tag_gateway")}</span>
            <span className="np-diagnostics__capability-tag">{t("capabilities.traceroute.tag_node")}</span>
          </div>
          {onRunTraceroute && (
            <button
              type="button"
              className="np-diagnostics__capability-btn"
              disabled={disabled}
              onClick={onRunTraceroute}
              aria-label={t("capabilities.traceroute.btn")}
            >
              <Icon name="timeline" style={{ width: "12px", height: "12px" }} />
              {t("capabilities.traceroute.btn")}
            </button>
          )}
        </div>

        {/* Card 4: Bufferbloat Test */}
        <div className="np-diagnostics__capability-card">
          <div className="np-diagnostics__capability-header">
            <div className="np-diagnostics__capability-icon">
              <Icon name="zap" />
            </div>
            <div>
              <h4 className="np-diagnostics__capability-title">{t("capabilities.bufferbloat.title")}</h4>
              <span style={{ fontSize: "0.72rem", color: "var(--np-text-mute)" }}>{t("capabilities.bufferbloat.subtitle")}</span>
            </div>
          </div>
          <p className="np-diagnostics__capability-desc">
            {t("capabilities.bufferbloat.desc")}
          </p>
          <div className="np-diagnostics__capability-tags">
            <span className="np-diagnostics__capability-tag">{t("capabilities.bufferbloat.tag_idle_loaded")}</span>
            <span className="np-diagnostics__capability-tag">{t("capabilities.bufferbloat.tag_qos")}</span>
            <span className="np-diagnostics__capability-tag">{t("capabilities.bufferbloat.tag_scorecard")}</span>
          </div>
          {onRunBufferbloat && (
            <button
              type="button"
              className="np-diagnostics__capability-btn"
              disabled={disabled}
              onClick={onRunBufferbloat}
              aria-label={t("capabilities.bufferbloat.btn")}
            >
              <Icon name="zap" style={{ width: "12px", height: "12px" }} />
              {t("capabilities.bufferbloat.btn")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
