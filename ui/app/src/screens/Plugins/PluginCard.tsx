import { useTranslation } from "react-i18next";
import type { PluginDescriptor } from "@netpulse/contract";
import { Button } from "@netpulse/components";
import { PluginConfigForm } from "./PluginConfigForm";

export interface PluginCardProps {
  p: PluginDescriptor;
  busy: boolean;
  onToggle: (enable: boolean) => void;
  onConfigure?: (config: any) => Promise<void>;
  onReset?: () => Promise<void>;
}

export function PluginCard({ p, busy, onToggle, onConfigure, onReset }: PluginCardProps) {
  const { t } = useTranslation(["plugins"]);

  const trust = p.trust || "unreviewed";
  const pluginType = p.plugin_type || "dissector";
  const capabilities = Array.isArray(p.capabilities) ? p.capabilities : [];

  const trustColorMap: Record<string, string> = {
    first_party: "#10b981",
    reviewed: "#60a5fa",
    unreviewed: "#f59e0b",
  };

  return (
    <article
      className={p.enabled ? "np-plugin np-plugin--on" : "np-plugin"}
      style={{
        background: "var(--np-surface-1, #131b2a)",
        border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
        borderRadius: "var(--np-radius-lg, 12px)",
        padding: "1.25rem 1.5rem",
        marginBottom: "1.25rem",
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
      }}
    >
      <header
        className="np-plugin__head"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "var(--np-text, #e2e8f0)" }}>
            🔌 {p.name}
          </h3>
          <span
            style={{
              fontSize: "0.78rem",
              padding: "0.2rem 0.65rem",
              borderRadius: "12px",
              background: "rgba(255,255,255,0.06)",
              color: "var(--np-subtext, #94a3b8)",
              fontWeight: 500,
            }}
          >
            {t(`types.${pluginType}` as any, { defaultValue: pluginType })}
          </span>
        </div>

        <span
          className={`np-plugin__trust np-plugin__trust--${trust}`}
          style={{
            fontSize: "0.8rem",
            fontWeight: 600,
            color: trustColorMap[trust] || "#94a3b8",
            display: "flex",
            alignItems: "center",
            gap: "0.35rem",
          }}
        >
          {t(`trust.${trust}` as any, { defaultValue: trust })}
        </span>
      </header>

      {/* Capability Tags */}
      {capabilities.length > 0 && (
        <div className="np-plugin__caps" style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.85rem" }}>
          {capabilities.map((c) => (
            <span
              key={c}
              className="np-plugin__cap"
              style={{
                fontSize: "0.75rem",
                padding: "0.15rem 0.5rem",
                borderRadius: "4px",
                background: "var(--np-surface-2, rgba(255, 255, 255, 0.08))",
                color: "var(--np-subtext, #94a3b8)",
              }}
            >
              {c.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}

      <div
        className="np-plugin__meta"
        style={{ display: "flex", gap: "1rem", fontSize: "0.85rem", color: "var(--np-subtext, #94a3b8)", marginBottom: "0.85rem", flexWrap: "wrap" }}
      >
        <span>{t("card.contract", { version: p.target_contract })}</span>
        <span style={{ color: p.compatible ? "#10b981" : "#f59e0b", fontWeight: 600 }}>
          {p.compatible ? t("card.compatible") : t("card.incompatible")}
        </span>
        {p.disabled_reason && (
          <span className="np-plugin__reason" style={{ color: "#ef4444" }}>
            ⚠️ {p.disabled_reason}
          </span>
        )}
      </div>

      <footer
        className="np-plugin__foot"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "0.75rem", borderTop: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))" }}
      >
        <span className="np-plugin__source" style={{ fontSize: "0.82rem", color: "var(--np-subtext, #94a3b8)" }}>
          📍 {p.source}
        </span>

        <Button
          variant={p.enabled ? "standard" : "primary"}
          disabled={busy || (!p.compatible && !p.enabled)}
          busy={busy}
          onClick={() => onToggle(!p.enabled)}
          style={p.enabled ? { border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.15))" } : undefined}
        >
          {p.enabled ? t("card.disable_action") : t("card.enable_action")}
        </Button>
      </footer>

      {/* Configuration Form Subsystem */}
      {onConfigure && onReset && (
        <PluginConfigForm
          plugin={p}
          busy={busy}
          onSave={(cfg) => onConfigure(cfg)}
          onReset={() => onReset()}
        />
      )}
    </article>
  );
}

