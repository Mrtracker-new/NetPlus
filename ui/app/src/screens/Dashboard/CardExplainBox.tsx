import { memo, useState, useEffect, useId } from "react";
import type { NarrativeCard, EvidenceRef } from "@netpulse/contract";
import { formatEvidenceLabel } from "@netpulse/components";
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
  const reactId = useId();
  const drawerId = card.at_mono_nanos != null
    ? `card-inline-drawer-${card.at_mono_nanos}`
    : `card-inline-drawer-${reactId}`;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const lowerHead = card.headline.toLowerCase();
  const lowerSum = (card.summary || "").toLowerCase();
  const allCardText = [lowerHead, lowerSum, ...card.lines.map((l) => l.toLowerCase())].join(" ");

  const protoUpper = (card.protocol || "").toUpperCase();
  const cat = card.category;

  // 1. Authoritative protocol resolution
  let isDns = protoUpper === "DNS" || cat === "dns";
  let isQuic = protoUpper === "QUIC" || protoUpper === "HTTP/3";
  let isTls = protoUpper === "TLS" || protoUpper === "HTTPS" || cat === "tls";
  let isHttp = protoUpper === "HTTP";
  let isUdp = protoUpper === "UDP";

  // 2. Safe word-boundary fallback if protocol and category are not set
  if (!protoUpper && !cat) {
    const isExplicitlyUnencrypted = /\b(not encrypted|unencrypted|cleartext)\b/i.test(allCardText);
    isDns = /\b(dns|domain name|dns query|dns lookup|dns response)\b/i.test(allCardText) ||
            /\bport\s+53\b/i.test(allCardText) ||
            /\b:53\b/.test(allCardText);
    isQuic = /\b(quic|http\/3)\b/i.test(allCardText) ||
             /\bport\s+443\/udp\b/i.test(allCardText);
    isTls = !isExplicitlyUnencrypted && (
      /\b(tls|https|ssl)\b/i.test(allCardText) ||
      /\bport\s+443\b/i.test(allCardText) ||
      /\b:443\b/.test(allCardText) ||
      (/\b(encrypt|encrypted)\b/i.test(allCardText) && !isExplicitlyUnencrypted)
    );
    isHttp = !isTls && !isQuic && (
      /\b(http|http\/1\.\d|http\/2)\b/i.test(allCardText) ||
      /\bport\s+80\b/i.test(allCardText) ||
      /\b:80\b/.test(allCardText)
    );
    isUdp = /\budp\b/i.test(allCardText) || isDns || isQuic;
  }

  // Grounded explanations based on authoritative protocol/category and severity
  let whyText = "This card represents observed passive network telemetry on your local adapter.";
  let actionText = "No immediate action required. NetPulse continues listening passively.";

  if (isDns) {
    whyText = "DNS queries resolve domain names (like github.com) to IP addresses. Higher latency usually happens when your configured DNS server responds slowly or over a congested Wi-Fi link.";
    actionText = "If web pages load slowly, consider switching to a fast DNS resolver (like 1.1.1.1 or 8.8.8.8) or run a diagnostic test in the Diagnostics tab.";
  } else if (isTls || isQuic) {
    whyText = "TLS handshakes establish encrypted connections to remote web servers. Spikes in TLS traffic indicate secure web browsing, streaming, or API requests.";
    actionText = "Your connection is encrypted and private. No action needed.";
  } else if (card.severity === "finding" || cat === "security") {
    whyText = "This finding was flagged because the network behavior deviated from typical local baselines (e.g., unexpected ports, retry bursts, or protocol anomalies).";
    actionText = "Review the process owning this flow in the Apps tab, or inspect raw packet headers below.";
  } else if (card.severity === "notable") {
    whyText = "This notable event recorded a transient change in throughput, host connectivity, or response timing.";
    actionText = "Monitor your active connections if performance degrades.";
  }

  const protocolLabel = isDns
    ? "DNS (Port 53)"
    : isQuic
    ? "QUIC / HTTP/3 (UDP Port 443)"
    : isTls
    ? "TLS / HTTPS (Port 443)"
    : isHttp
    ? "HTTP (Port 80)"
    : isUdp
    ? "UDP Datagram"
    : card.protocol
    ? `${card.protocol} ${card.protocol.toUpperCase() === "TCP" ? "Stream" : ""}`.trim()
    : "TCP Stream";

  const transportSecurity = isQuic
    ? "QUIC / TLS 1.3 Confidential"
    : isTls
    ? "TLS Encrypted / Confidential"
    : isDns
    ? "Standard DNS / Unencrypted"
    : "Cleartext Transport";

  const evidenceRef = card.evidence && card.evidence.length > 0 ? card.evidence[0] : null;
  const label = evidenceRef ? formatEvidenceLabel(evidenceRef) : "Evidence Ref";

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
        <div id={drawerId} className="np-inline-drawer" role="region" aria-label="Quick Peek Technical Evidence">
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
              <h5 className="np-inline-drawer__sub">Observation Grounding</h5>
              <div
                className="np-direct-observation-badge"
                style={{
                  padding: "0.5rem 0.75rem",
                  background: "var(--np-surface-2, rgba(255,255,255,0.04))",
                  borderRadius: "var(--np-radius-sm, 6px)",
                  border: "1px solid var(--np-border, rgba(255,255,255,0.06))",
                }}
              >
                <span className="np-badge np-badge--healthy" style={{ fontSize: "0.75rem" }}>
                  ● Direct Observation
                </span>
                <p
                  style={{
                    margin: "0.35rem 0 0 0",
                    fontSize: "0.75rem",
                    color: "var(--np-text-mute, #a0aec0)",
                    lineHeight: 1.3,
                  }}
                >
                  Direct wire capture. Telemetry grounded in reconstructed packet and flow headers.
                </p>
              </div>
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
            aria-expanded={showInlineDrawer}
            aria-controls={drawerId}
            style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
          >
            <Icon name="search" style={{ width: "12px", height: "12px" }} />
            {showInlineDrawer ? "Hide Quick Peek Drawer" : "Quick Peek Drawer"}
          </button>
        )}
        {!showInlineDrawer && onNavigateToScreen && evidenceRef && (
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
