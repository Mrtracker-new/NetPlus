import { memo, useState, useEffect } from "react";
import type { NarrativeCard, EvidenceRef } from "@netpulse/contract";
import { formatEvidenceLabel } from "@netpulse/components";
import { ConfidenceMeter } from "@netpulse/viz";
import { Icon } from "../../icons";

interface CardExplainBoxProps {
  card: NarrativeCard;
  onNavigateToScreen?: (ref: EvidenceRef) => void;
  onClose: () => void;
}

export const CardExplainBox = memo(function CardExplainBox({
  card,
  onNavigateToScreen,
  onClose,
}: CardExplainBoxProps) {
  const [showInlineDrawer, setShowInlineDrawer] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Grounded explanations based on severity and headline
  let whyText = "This card represents observed passive network telemetry on your local adapter.";
  let actionText = "No immediate action required. NetPulse continues listening passively.";

  const lowerHead = card.headline.toLowerCase();
  const lowerSum = (card.summary || "").toLowerCase();

  if (lowerHead.includes("dns") || lowerSum.includes("dns")) {
    whyText = "DNS queries resolve domain names (like github.com) to IP addresses. Higher latency usually happens when your configured DNS server responds slowly or over a congested Wi-Fi link.";
    actionText = "If web pages load slowly, consider switching to a fast DNS resolver (like 1.1.1.1 or 8.8.8.8) or run a diagnostic test in the Diagnostics tab.";
  } else if (lowerHead.includes("tls") || lowerSum.includes("tls") || lowerHead.includes("https")) {
    whyText = "TLS handshakes establish encrypted connections to remote web servers. Spikes in TLS traffic indicate secure web browsing, streaming, or API requests.";
    actionText = "Your connection is encrypted and private. No action needed.";
  } else if (card.severity === "finding") {
    whyText = "This finding was flagged because the network behavior deviated from typical local baselines (e.g., unexpected ports, retry bursts, or protocol anomalies).";
    actionText = "Review the process owning this flow in the Apps tab, or inspect raw packet headers below.";
  } else if (card.severity === "notable") {
    whyText = "This notable event recorded a transient change in throughput, host connectivity, or response timing.";
    actionText = "Monitor your active connections if performance degrades.";
  }

  const isDns = lowerHead.includes("dns") || lowerSum.includes("dns");
  const isTls = lowerHead.includes("tls") || lowerSum.includes("tls") || lowerHead.includes("https");
  const isHttp = lowerHead.includes("http") || lowerSum.includes("http");
  const isUdp = lowerHead.includes("udp") || isDns;
  const protocolLabel = isDns ? "DNS (Port 53)" : isTls ? "TLS / HTTPS (Port 443)" : isHttp ? "HTTP (Port 80)" : isUdp ? "UDP Datagram" : "TCP Stream";
  const transportSecurity = isTls ? "TLS Encrypted / Confidential" : isDns ? "Standard DNS / Unencrypted" : "Cleartext Transport";

  const evidenceRef = card.evidence && card.evidence.length > 0 ? card.evidence[0] : null;
  const label = evidenceRef ? formatEvidenceLabel(evidenceRef) : "Evidence Ref";
  const confidencePct = card.severity === "finding" ? 92 : card.severity === "notable" ? 78 : 65;

  return (
    <div className="np-explain-box" role="region" aria-label="Explanation details">
      <div className="np-explain-box__header">
        <span className="np-explain-box__tag" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <Icon name="lightbulb" style={{ width: "13px", height: "13px" }} />
          Explanation
        </span>
        <button
          type="button"
          className="np-explain-box__close"
          onClick={onClose}
          aria-label="Close explanation"
        >
          <Icon name="close" style={{ width: "14px", height: "14px" }} />
        </button>
      </div>

      <div className="np-explain-box__section">
        <h4 className="np-explain-box__label">Why is this happening?</h4>
        <p className="np-explain-box__text">{whyText}</p>
      </div>

      <div className="np-explain-box__section">
        <h4 className="np-explain-box__label">What should I do?</h4>
        <p className="np-explain-box__text">{actionText}</p>
      </div>

      {/* Complete In-Card Quick Peek Drawer */}
      {showInlineDrawer && evidenceRef && (
        <div className="np-inline-drawer" role="region" aria-label="Quick Peek Technical Evidence">
          <div className="np-inline-drawer__header">
            <span className="np-evidence np-evidence--static">{label}</span>
            <span className="np-inline-drawer__title">Quick Peek Technical Evidence</span>
            <button
              type="button"
              className="np-inline-drawer__close"
              onClick={() => setShowInlineDrawer(false)}
              aria-label="Close technical drawer"
            >
              <Icon name="close" style={{ width: "14px", height: "14px" }} />
            </button>
          </div>

          <div className="np-inline-drawer__grid">
            <div className="np-inline-drawer__col">
              <h5 className="np-inline-drawer__sub">Evidence Confidence</h5>
              <ConfidenceMeter percent={confidencePct} qualitative={card.severity} />
            </div>

            <div className="np-inline-drawer__col">
              <h5 className="np-inline-drawer__sub">Protocol Context</h5>
              <ul className="np-inline-drawer__list">
                <li><span>Kind:</span> <strong>{evidenceRef.kind}</strong></li>
                <li><span>ID:</span> <code>#{evidenceRef.id}</code></li>
                <li><span>Protocol:</span> <strong>{protocolLabel}</strong></li>
                <li><span>Transport Security:</span> <strong>{transportSecurity}</strong></li>
                <li><span>Observation Mode:</span> <strong>Passive / Non-Intervening</strong></li>
              </ul>
            </div>
          </div>

          {card.lines.length > 0 && (
            <div className="np-inline-drawer__section">
              <h5 className="np-inline-drawer__sub">Telemetry Observables</h5>
              <ul className="np-inline-drawer__observables">
                {card.lines.map((line, idx) => (
                  <li key={idx}>• {line}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="np-inline-drawer__section">
            <h5 className="np-inline-drawer__sub">Payload Policy & Telemetry Status</h5>
            <div className="np-explain-box__payload-notice" style={{ padding: "0.75rem", background: "var(--np-surface-2, rgba(255,255,255,0.03))", borderRadius: "var(--np-radius-sm, 6px)", fontSize: "0.8rem", color: "var(--np-text-mute, #a0aec0)" }}>
              <div><strong>Policy:</strong> Metadata-Only Capture (Payload bytes omitted by design for zero-leak privacy)</div>
              <div style={{ marginTop: "0.25rem" }}><strong>Evidence Handle:</strong> {evidenceRef.kind} #{evidenceRef.id} (Monotonic Time: {card.at_mono_nanos ? `${(card.at_mono_nanos / 1_000_000_000).toFixed(3)}s` : "live"})</div>
            </div>
          </div>

          <div className="np-inline-drawer__foot">
            {onNavigateToScreen && (
              <button
                type="button"
                className="np-btn np-btn--primary np-btn--sm"
                onClick={() => onNavigateToScreen(evidenceRef)}
              >
                Inspect Technical Evidence →
              </button>
            )}
          </div>
        </div>
      )}

      <div className="np-explain-box__footer">
        {evidenceRef && (
          <button
            type="button"
            className={`np-btn np-btn--sm ${showInlineDrawer ? "np-btn--primary" : "np-btn--ghost"}`}
            onClick={() => setShowInlineDrawer(!showInlineDrawer)}
            style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
          >
            <Icon name="search" style={{ width: "12px", height: "12px" }} />
            {showInlineDrawer ? "Hide Quick Peek Drawer" : "Quick Peek Drawer"}
          </button>
        )}
        {onNavigateToScreen && evidenceRef && (
          <button
            type="button"
            className="np-btn np-btn--primary np-btn--sm"
            onClick={() => onNavigateToScreen(evidenceRef)}
          >
            Inspect Technical Evidence →
          </button>
        )}
      </div>
    </div>
  );
});
