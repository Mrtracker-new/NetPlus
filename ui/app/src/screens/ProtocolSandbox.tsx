import { useTranslation } from "react-i18next";
import { Notice, Skeleton, EmptyState } from "@netpulse/components";
import { useSandboxController } from "../hooks/useSandboxController";
import { LayerBuilder } from "./Sandbox/LayerBuilder";
import { HexViewer } from "./Sandbox/HexViewer";
import { RfcDiagnostics } from "./Sandbox/RfcDiagnostics";

export function ProtocolSandboxScreen() {
  const { t } = useTranslation(["sandbox", "common"]);
  const {
    layers,
    selectedLayerToAdd,
    setSelectedLayerToAdd,
    inspection,
    isBuilding,
    notice,
    setNotice,
    toast,
    announcement,
    actions,
  } = useSandboxController();

  return (
    <section className="np-sandbox" aria-labelledby="protocol-sandbox-title">
      {/* Screen Reader Live Region */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <h2 id="protocol-sandbox-title">{t("title")}</h2>
      <p className="np-sandbox__desc" style={{ color: "var(--np-subtext, #94a3b8)", marginBottom: "1.25rem" }}>
        {t("desc")}
      </p>

      {notice && <Notice message={notice} level="error" onDismiss={() => setNotice(null)} />}

      {/* Layer Stack Builder Controls */}
      <LayerBuilder
        layers={layers}
        selectedLayerToAdd={selectedLayerToAdd}
        onSelectLayerToAdd={setSelectedLayerToAdd}
        onAddLayer={actions.addLayer}
        onRemoveLayer={actions.removeLayer}
        onMoveLayer={actions.moveLayer}
        onLoadPreset={actions.loadPreset}
        onInspect={() => void actions.inspectPacket()}
        isBuilding={isBuilding}
      />

      {/* Main Inspection Grid */}
      {isBuilding ? (
        <div role="status" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Skeleton height="180px" />
          <Skeleton height="140px" />
        </div>
      ) : inspection ? (
        <div className="np-sandbox__inspection-results">
          {/* Wireshark Hex Dump Viewer */}
          <HexViewer
            rawHex={inspection.rawHex}
            onCopyHex={actions.copyHex}
            onCopyJson={actions.copyJson}
            toast={toast}
          />

          {/* RFC Diagnostic Field Validation */}
          <RfcDiagnostics diagnostics={inspection.diagnostics} />
        </div>
      ) : (
        <EmptyState>{t("empty")}</EmptyState>
      )}
    </section>
  );
}
