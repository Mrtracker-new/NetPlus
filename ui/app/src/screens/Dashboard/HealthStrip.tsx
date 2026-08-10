import { memo } from "react";
import type { HealthViewModel } from "./viewModels";

interface HealthStripProps {
  health: HealthViewModel;
}

export const HealthStrip = memo(function HealthStrip({ health }: HealthStripProps) {
  return (
    <div className="np-health-strip" role="region" aria-label="System Health Telemetry">
      <div className="np-health-strip__item" title="Live Frame Capture Driver">
        <span className={`np-health-dot ${health.capture.connected ? "np-health-dot--active" : ""}`} aria-hidden="true" />
        <span className="np-health-strip__label">Capture:</span>
        <span className="np-health-strip__val">{health.capture.label}</span>
      </div>

      <div className="np-health-strip__divider" aria-hidden="true">•</div>

      <div className="np-health-strip__item" title="Flow Attribution Engine">
        <span className={`np-health-dot ${health.flowEngine.healthy ? "np-health-dot--active" : ""}`} aria-hidden="true" />
        <span className="np-health-strip__label">Flow Engine:</span>
        <span className="np-health-strip__val">{health.flowEngine.label}</span>
      </div>

      <div className="np-health-strip__divider" aria-hidden="true">•</div>

      <div className="np-health-strip__item" title="Ring Buffer Storage">
        <span className={`np-health-dot ${health.storage.healthy ? "np-health-dot--active" : ""}`} aria-hidden="true" />
        <span className="np-health-strip__label">Storage:</span>
        <span className="np-health-strip__val">{health.storage.label}</span>
      </div>

      <div className="np-health-strip__divider" aria-hidden="true">•</div>

      <div className="np-health-strip__item" title="Local Inference & AI Engine">
        <span className={`np-health-dot ${health.ai.ready ? "np-health-dot--active" : ""}`} aria-hidden="true" />
        <span className="np-health-strip__label">AI Engine:</span>
        <span className="np-health-strip__val">{health.ai.label}</span>
      </div>

      <div className="np-health-strip__divider" aria-hidden="true">•</div>

      <div className="np-health-strip__item" title="Npcap Packet Capture Interface">
        <span className={`np-health-dot ${health.npcap.connected ? "np-health-dot--active" : ""}`} aria-hidden="true" />
        <span className="np-health-strip__label">Npcap:</span>
        <span className="np-health-strip__val">{health.npcap.label}</span>
      </div>

      <div className="np-health-strip__divider" aria-hidden="true">•</div>

      <div className="np-health-strip__item" title="Packet Drop Count">
        <span className="np-health-strip__label">Drops:</span>
        <span className={health.drops > 0 ? "np-health-strip__val np-health-strip__val--warning" : "np-health-strip__val"}>
          {health.drops}
        </span>
      </div>
    </div>
  );
});
