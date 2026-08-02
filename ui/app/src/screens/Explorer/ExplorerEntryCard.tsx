import { useTranslation } from "react-i18next";
import type { ExplorerEntry, ProjectionDepth } from "@netpulse/contract";

export interface ExplorerEntryCardProps {
  entry: ExplorerEntry;
  depth: ProjectionDepth;
  onSelectRelated: (relatedKey: string) => void;
}

function contentAt(entry: ExplorerEntry, depth: ProjectionDepth): string {
  if (depth === "expert") return entry.expert;
  if (depth === "intermediate") return entry.intermediate;
  return entry.beginner;
}

export function ExplorerEntryCard({ entry, depth, onSelectRelated }: ExplorerEntryCardProps) {
  const { t } = useTranslation(["explorer"]);

  return (
    <article
      className="np-ref"
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
        className="np-ref__key"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
            {entry.title}
          </h3>
          <code
            className="np-ref__id"
            style={{
              fontSize: "0.78rem",
              padding: "0.15rem 0.45rem",
              background: "rgba(0,0,0,0.4)",
              borderRadius: "4px",
              color: "var(--np-accent, #2fe0d6)",
            }}
          >
            {entry.key}
          </code>
        </div>

        {entry.examples_available && (
          <span
            className="np-ref__mine"
            style={{
              fontSize: "0.78rem",
              padding: "0.2rem 0.6rem",
              borderRadius: "12px",
              background: "rgba(16, 185, 129, 0.2)",
              color: "#10b981",
              fontWeight: 600,
            }}
          >
            🎯 {t("card.example_tag")}
          </span>
        )}
      </header>

      {/* Main explanation body */}
      <p className="np-ref__body" style={{ fontSize: "0.95rem", color: "var(--np-text, #e2e8f0)", lineHeight: "1.6", margin: "0 0 1rem 0" }}>
        {contentAt(entry, depth)}
      </p>

      {/* Collapsible Expert Detail */}
      {depth !== "expert" && entry.expert && (
        <details
          className="np-ref__more"
          style={{
            marginBottom: "1rem",
            fontSize: "0.85rem",
            color: "var(--np-subtext, #94a3b8)",
            background: "var(--np-bg, #0b1019)",
            border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
            borderRadius: "var(--np-radius-md, 6px)",
            padding: "0.75rem 1rem",
          }}
        >
          <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
            🔬 {t("card.expert_detail")}
          </summary>
          <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.88rem", lineHeight: "1.5" }}>
            {entry.expert}
          </p>
        </details>
      )}

      {/* Interactive Related Topic Badges */}
      {entry.related && entry.related.length > 0 && (
        <footer
          className="np-ref__related"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            flexWrap: "wrap",
            paddingTop: "0.75rem",
            borderTop: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))",
          }}
        >
          <span style={{ fontSize: "0.8rem", color: "var(--np-subtext, #94a3b8)", fontWeight: 500 }}>
            {t("card.related_title")}:
          </span>
          {entry.related.map((k) => (
            <button
              key={k}
              type="button"
              className="np-btn np-btn--ghost"
              style={{ fontSize: "0.78rem", padding: "0.2rem 0.5rem", borderRadius: "4px" }}
              onClick={() => onSelectRelated(k)}
            >
              <code>{k}</code>
            </button>
          ))}
        </footer>
      )}
    </article>
  );
}
