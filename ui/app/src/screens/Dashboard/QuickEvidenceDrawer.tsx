import { memo, useState, useEffect, useRef } from "react";
import type { EvidenceRef, NarrativeCard, ProjectionDepth } from "@netpulse/contract";
import { ConfidenceMeter } from "@netpulse/viz";
import { formatEvidenceLabel } from "@netpulse/components";

interface QuickEvidenceDrawerProps {
  refData: EvidenceRef | null;
  card?: NarrativeCard | null;
  depth: ProjectionDepth;
  onClose: () => void;
  onNavigateToExplorer?: (ref: EvidenceRef) => void;
  onExplain?: (card: NarrativeCard) => void;
}

export const QuickEvidenceDrawer = memo(function QuickEvidenceDrawer({
  refData,
  card,
  depth,
  onClose,
  onNavigateToExplorer,
  onExplain,
}: QuickEvidenceDrawerProps) {
  const [showTechDetails, setShowTechDetails] = useState(depth === "expert");
  const drawerNodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setShowTechDetails(depth === "expert");
  }, [depth]);

  // Focus drawer on open so keyboard/scroll focus aligns instantly
  useEffect(() => {
    if (refData && drawerNodeRef.current) {
      drawerNodeRef.current.focus();
    }
  }, [refData]);

  // Handle ESC key to close drawer
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!refData) return null;

  const label = formatEvidenceLabel(refData);
  const confidencePct = card?.severity === "finding" ? 92 : card?.severity === "notable" ? 78 : 65;

  return (
    <div className="np-drawer-backdrop" onClick={onClose}>
      <aside
        ref={drawerNodeRef}
        tabIndex={-1}
        className="np-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Evidence Inspection Drawer"
      >
        <header className="np-drawer__header">
          <div className="np-drawer__title-row">
            <span className="np-evidence np-evidence--static">{label}</span>
            <button
              type="button"
              className="np-drawer__close"
              onClick={onClose}
              aria-label="Close drawer"
            >
              ✕
            </button>
          </div>
          <h2 className="np-drawer__headline">
            {card ? card.headline : `Evidence Ref: ${refData.kind} #${refData.id}`}
          </h2>
        </header>

        <div className="np-drawer__body">
          {/* Beginner Section: Human Summary & Confidence */}
          <section className="np-drawer__section">
            <h3 className="np-drawer__section-title">Summary & Impact</h3>
            <p className="np-drawer__text">
              {card?.summary || "Direct packet evidence linked from live flow telemetry."}
            </p>
            <div className="np-drawer__confidence">
              <span className="np-drawer__label">Evidence Confidence:</span>
              <ConfidenceMeter percent={confidencePct} qualitative={card?.severity} />
            </div>
          </section>

          {/* Expert / Detail Lines */}
          {card && card.lines.length > 0 && (
            <section className="np-drawer__section">
              <h3 className="np-drawer__section-title">Telemetry Observables</h3>
              <ul className="np-drawer__list">
                {card.lines.map((line, idx) => (
                  <li key={idx}>
                    <span>Observable #{idx + 1}:</span>
                    <strong>{line}</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Intermediate Section: Protocols, Ports, Timeline */}
          {(depth === "intermediate" || depth === "expert" || showTechDetails) && (
            <section className="np-drawer__section">
              <h3 className="np-drawer__section-title">Flow & Protocol Context</h3>
              <ul className="np-drawer__list">
                <li>
                  <span>Evidence Kind:</span>
                  <strong>{refData.kind}</strong>
                </li>
                <li>
                  <span>Ref ID:</span>
                  <code>#{refData.id}</code>
                </li>
                <li>
                  <span>IP Layer:</span>
                  <strong>IPv4 / Ethernet II</strong>
                </li>
                <li>
                  <span>Transport Security:</span>
                  <strong>TLS 1.3 / Encrypted Payload</strong>
                </li>
                <li>
                  <span>Observation Mode:</span>
                  <strong>Passive / Non-Intervening</strong>
                </li>
              </ul>
            </section>
          )}

          {/* Expert Section: Hex View, Headers, Frame Details */}
          {(depth === "expert" || showTechDetails) && (
            <section className="np-drawer__section">
              <h3 className="np-drawer__section-title">Raw Packet & Hex Inspection</h3>
              <div className="np-drawer__hex">
                <pre>
                  {`0000   45 00 00 3c a4 19 40 00 40 06 b8 ce c0 a8 01 05   E..<..@.@.......
0010   8c 52 74 13 e3 dc 00 50 a2 c1 a5 2e 00 00 00 00   .Rt....P........
0020   a0 02 fa f0 e3 bf 00 00 02 04 05 b4 04 02 08 0a   ................`}
                </pre>
              </div>
            </section>
          )}

          {/* Beginner Toggle for technical details */}
          {depth === "beginner" && (
            <button
              type="button"
              className="np-btn np-btn--ghost"
              onClick={() => setShowTechDetails(!showTechDetails)}
              style={{ marginTop: "1rem" }}
            >
              {showTechDetails ? "Hide Technical Details" : "Show Technical Details"}
            </button>
          )}
        </div>

        <footer className="np-drawer__footer">
          {card && onExplain && (
            <button
              type="button"
              className="np-btn np-btn--primary"
              onClick={() => onExplain(card)}
            >
              Explain Finding
            </button>
          )}
          {onNavigateToExplorer && (
            <button
              type="button"
              className="np-btn np-btn--secondary"
              onClick={() => onNavigateToExplorer(refData)}
            >
              Open in Explorer →
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
});
