import { useTranslation } from "react-i18next";
import { Button } from "@netpulse/components";
import { Icon } from "../../icons";

export interface EmptySandboxStateProps {
  onLoadPreset: (presetKey: string) => void;
  isBuilding: boolean;
}

export function EmptySandboxState({ onLoadPreset, isBuilding }: EmptySandboxStateProps) {
  const { t } = useTranslation(["sandbox"]);

  const presets = [
    { key: "http1", label: "HTTP/1.1 Stack" },
    { key: "http3", label: "HTTP/3 Stack" },
    { key: "dns", label: "DNS Query" },
    { key: "tls", label: "TLS 1.3 Secure" },
    { key: "icmp", label: "ICMP Echo" },
  ];

  return (
    <div className="np-sandbox__empty" role="region" aria-label={t("empty")}>
      <div className="np-sandbox__empty-icon">
        <Icon name="sandbox" style={{ width: 26, height: 26 }} />
      </div>

      <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.1rem", fontWeight: 600, color: "var(--np-text)" }}>
        Interactive Packet Builder
      </h3>
      <p style={{ margin: "0 0 1.25rem 0", fontSize: "0.88rem", color: "var(--np-subtext)", maxWidth: "480px", lineHeight: "1.5" }}>
        Select a template or configure protocol layers above, then click <strong>Build &amp; Inspect Packet</strong> to inspect raw hex dumps and RFC diagnostic field validation.
      </p>

      {/* Quick Launch Preset Pills */}
      <div className="np-sandbox__presets-bar" style={{ justifyContent: "center", marginTop: "0.5rem" }}>
        <span style={{ fontSize: "0.75rem", color: "var(--np-muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600, width: "100%", textAlign: "center" }}>
          Quick Template Presets
        </span>
        {presets.map((p) => (
          <Button
            key={p.key}
            variant="standard"
            disabled={isBuilding}
            onClick={() => onLoadPreset(p.key)}
            aria-label={`Load ${p.label} preset`}
          >
            {p.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
