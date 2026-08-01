import { useTranslation } from "react-i18next";
import { Button } from "@netpulse/components";
import { AVAILABLE_LAYERS } from "../../hooks/useSandboxController";

export interface LayerBuilderProps {
  layers: string[];
  selectedLayerToAdd: string;
  onSelectLayerToAdd: (layer: string) => void;
  onAddLayer: () => void;
  onRemoveLayer: (index: number) => void;
  onMoveLayer: (index: number, direction: "up" | "down") => void;
  onLoadPreset: (presetKey: string) => void;
  onInspect: () => void;
  isBuilding: boolean;
}

export function LayerBuilder({
  layers,
  selectedLayerToAdd,
  onSelectLayerToAdd,
  onAddLayer,
  onRemoveLayer,
  onMoveLayer,
  onLoadPreset,
  onInspect,
  isBuilding,
}: LayerBuilderProps) {
  const { t } = useTranslation(["sandbox"]);

  const presets = [
    { key: "http1", labelKey: "http1_stack" },
    { key: "http3", labelKey: "http3_stack" },
    { key: "dns", labelKey: "dns_stack" },
    { key: "tls", labelKey: "tls_stack" },
    { key: "icmp", labelKey: "icmp_stack" },
  ];

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      {/* Presets Bar */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", marginBottom: "1.25rem" }}>
        <Button variant="primary" busy={isBuilding} disabled={isBuilding} onClick={onInspect}>
          {t("build_btn")}
        </Button>
        {presets.map((p) => (
          <Button
            key={p.key}
            variant="standard"
            disabled={isBuilding}
            onClick={() => onLoadPreset(p.key)}
            style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem" }}
          >
            {t(p.labelKey as any)}
          </Button>
        ))}
      </div>

      {/* Interactive Layer Builder Controls */}
      <section
        style={{
          background: "var(--np-surface-1, #131b2a)",
          border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
          borderRadius: "var(--np-radius-lg, 12px)",
          padding: "1.25rem 1.5rem",
          boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
        }}
        aria-label={t("layer_builder")}
      >
        <h3 style={{ margin: "0 0 1rem 0", fontSize: "1rem", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
          {t("layer_builder")}
        </h3>

        {/* Layer Dropdown + Add Button */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          <select
            value={selectedLayerToAdd}
            onChange={(e) => onSelectLayerToAdd(e.target.value)}
            style={{
              padding: "0.4rem 0.75rem",
              fontSize: "0.85rem",
              borderRadius: "var(--np-radius-md, 8px)",
              border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.15))",
              background: "var(--np-bg, #0b1019)",
              color: "var(--np-text, #e2e8f0)",
              outline: "none",
            }}
          >
            {AVAILABLE_LAYERS.map((layer) => (
              <option key={layer} value={layer}>
                {layer}
              </option>
            ))}
          </select>
          <Button variant="standard" onClick={onAddLayer} disabled={isBuilding}>
            + {t("add_layer")}
          </Button>
        </div>

        {/* Current Configured Layer Stack List */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {layers.map((layer, index) => (
            <div
              key={`${layer}-${index}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "var(--np-bg, #0b1019)",
                padding: "0.5rem 0.85rem",
                borderRadius: "var(--np-radius-md, 8px)",
                border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--np-accent, #2fe0d6)" }}>
                  L{index + 1}
                </span>
                <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
                  {layer}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <button
                  type="button"
                  className="np-btn np-btn--ghost"
                  style={{ fontSize: "0.75rem", padding: "0.15rem 0.4rem" }}
                  disabled={index === 0 || isBuilding}
                  onClick={() => onMoveLayer(index, "up")}
                  title={t("move_up")}
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="np-btn np-btn--ghost"
                  style={{ fontSize: "0.75rem", padding: "0.15rem 0.4rem" }}
                  disabled={index === layers.length - 1 || isBuilding}
                  onClick={() => onMoveLayer(index, "down")}
                  title={t("move_down")}
                >
                  ▼
                </button>
                <button
                  type="button"
                  className="np-btn np-btn--ghost"
                  style={{ fontSize: "0.75rem", padding: "0.15rem 0.4rem", color: "var(--np-danger, #ff5c7c)" }}
                  disabled={layers.length <= 1 || isBuilding}
                  onClick={() => onRemoveLayer(index)}
                  title={t("remove_layer")}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
