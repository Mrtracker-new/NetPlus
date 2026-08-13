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

  return (
    <article className={p.enabled ? "np-plugin np-plugin--on" : "np-plugin"}>
      <header className="np-plugin__head">
        <div className="np-plugin__title-group">
          <h3 className="np-plugin__name">
            🔌 {p.name}
          </h3>
          <span className="np-plugin__type-badge">
            {t(`types.${pluginType}` as any, { defaultValue: pluginType })}
          </span>
        </div>

        <span className={`np-plugin__trust np-plugin__trust--${trust}`}>
          {t(`trust.${trust}` as any, { defaultValue: trust })}
        </span>
      </header>

      {/* Capability Tags */}
      {capabilities.length > 0 && (
        <div className="np-plugin__caps">
          {capabilities.map((c) => (
            <span key={c} className="np-plugin__cap">
              {c.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}

      <div className="np-plugin__meta">
        <span className="np-plugin__contract">{t("card.contract", { version: p.target_contract })}</span>
        <span className={p.compatible ? "np-plugin__compat--valid" : "np-plugin__compat--invalid"}>
          {p.compatible ? t("card.compatible") : t("card.incompatible")}
        </span>
        {p.disabled_reason && (
          <span className="np-plugin__reason">
            ⚠️ {p.disabled_reason}
          </span>
        )}
      </div>

      <footer className="np-plugin__foot">
        <span className="np-plugin__source">
          📍 {p.source}
        </span>

        <Button
          variant={p.enabled ? "standard" : "primary"}
          disabled={busy || (!p.compatible && !p.enabled)}
          busy={busy}
          onClick={() => onToggle(!p.enabled)}
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


