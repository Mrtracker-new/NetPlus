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
      {/* Decoupled Layer Stack Templates Bar */}
      <div className="np-sandbox__preset-bar" aria-label="Layer Stack Templates">
        <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--np-subtext)", marginRight: "0.25rem" }}>
          Templates:
        </span>
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            className="np-sandbox__preset-chip"
            disabled={isBuilding}
            onClick={() => onLoadPreset(p.key)}
            aria-label={`Load ${t(p.labelKey as any)} template`}
          >
            {t(p.labelKey as any)}
          </button>
        ))}
      </div>

      {/* Interactive Layer Builder Panel */}
      <section className="np-sandbox__card" aria-label={t("layer_builder")}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600, color: "var(--np-text)" }}>
              {t("layer_builder")}
            </h3>
            <span style={{ fontSize: "0.8rem", color: "var(--np-subtext)" }}>
              Configure active protocol stack sequence
            </span>
          </div>

          <Button variant="primary" busy={isBuilding} disabled={isBuilding} onClick={onInspect}>
            {t("build_btn")}
          </Button>
        </div>

        {/* Layer Dropdown + Add Button */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          <select
            value={selectedLayerToAdd}
            onChange={(e) => onSelectLayerToAdd(e.target.value)}
            className="np-sandbox__select"
            aria-label="Select layer to add"
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
          {layers.map((layer, index) => {
            const isFirst = index === 0;
            const isLast = index === layers.length - 1;
            const isOnlyOne = layers.length <= 1;

            return (
              <div key={`${layer}-${index}`} className="np-sandbox__layer-card">
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span className="np-sandbox__layer-badge">
                    L{index + 1}
                  </span>
                  <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--np-text)" }}>
                    {layer}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                  <button
                    type="button"
                    className="np-btn np-btn--ghost"
                    style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                    disabled={isFirst || isBuilding}
                    onClick={() => onMoveLayer(index, "up")}
                    aria-label={`Move ${layer} layer up`}
                    title={`Move ${layer} layer up`}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="np-btn np-btn--ghost"
                    style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                    disabled={isLast || isBuilding}
                    onClick={() => onMoveLayer(index, "down")}
                    aria-label={`Move ${layer} layer down`}
                    title={`Move ${layer} layer down`}
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    className="np-btn np-btn--ghost"
                    style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", color: "var(--np-finding)" }}
                    disabled={isOnlyOne || isBuilding}
                    onClick={() => onRemoveLayer(index)}
                    aria-label={`Remove ${layer} layer`}
                    title={`Remove ${layer} layer`}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
