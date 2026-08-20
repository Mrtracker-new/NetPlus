import { useTranslation } from "react-i18next";
import type { ExplorerEntry, ProjectionDepth } from "@netpulse/contract";
import { Badge, Button, Card } from "@netpulse/components";
import { Icon } from "../../icons";

export interface ExplorerEntryCardProps {
  entry: ExplorerEntry;
  depth: ProjectionDepth;
  onSelectRelated: (relatedKey: string) => void;
  onOpenLesson?: (lessonId: string) => void;
}

function contentAt(entry: ExplorerEntry, depth: ProjectionDepth): string {
  if (depth === "expert") return entry.expert;
  if (depth === "intermediate") return entry.intermediate;
  return entry.beginner;
}

export function ExplorerEntryCard({
  entry,
  depth,
  onSelectRelated,
  onOpenLesson,
}: ExplorerEntryCardProps) {
  const { t } = useTranslation(["explorer"]);

  return (
    <Card className="np-ref">
      <header className="np-ref__key">
        <div className="np-ref__title-group">
          <h3 className="np-ref__title">
            {entry.title}
          </h3>
          <code className="np-ref__id">
            {entry.key}
          </code>
        </div>

        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
          {entry.layer && (
            <Badge variant="level">
              {entry.layer}
            </Badge>
          )}

          {entry.examples_available && (
            <Badge variant="trust" className="np-ref__mine">
              🎯 {t("card.example_tag", { defaultValue: "Observed" })}
            </Badge>
          )}
        </div>
      </header>

      {/* Main explanation body */}
      <p className="np-ref__body">
        {contentAt(entry, depth)}
      </p>

      {/* Collapsible Expert Detail */}
      {depth !== "expert" && entry.expert && (
        <details className="np-ref__more">
          <summary>
            🔬 {t("card.expert_detail", { defaultValue: "Technical Detail" })}
          </summary>
          <p className="np-ref__more-content">
            {entry.expert}
          </p>
        </details>
      )}

      {/* RFC References */}
      {entry.rfc_references && entry.rfc_references.length > 0 && (
        <div style={{ fontSize: "0.8rem", color: "var(--np-text-mute)", marginTop: "0.5rem" }}>
          <strong>Standards:</strong>{" "}
          {entry.rfc_references.map((rfc, idx) => (
            <span key={rfc}>
              {idx > 0 && ", "}
              <a
                href={`https://datatracker.ietf.org/doc/html/rfc${rfc}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--np-accent)", textDecoration: "underline" }}
              >
                RFC {rfc}
              </a>
            </span>
          ))}
        </div>
      )}

      {/* Related Lessons Linkage */}
      {entry.related_lessons && entry.related_lessons.length > 0 && (
        <div style={{ fontSize: "0.8rem", color: "var(--np-text-mute)", marginTop: "0.5rem" }}>
          <strong>Interactive Lessons:</strong>{" "}
          {entry.related_lessons.map((lessonId) => (
            <Button
              key={lessonId}
              type="button"
              variant="standard"
              style={{ fontSize: "0.75rem", padding: "0.15rem 0.5rem", marginLeft: "0.4rem" }}
              onClick={() => onOpenLesson && onOpenLesson(lessonId)}
            >
              📖 {lessonId}
            </Button>
          ))}
        </div>
      )}

      {/* Interactive Related Topic Badges */}
      {entry.related && entry.related.length > 0 && (
        <footer className="np-ref__related">
          <span className="np-ref__related-title">
            {t("card.related_title")}:
          </span>
          {entry.related.map((k) => (
            <Button
              key={k}
              type="button"
              variant="standard"
              className="np-ref__related-chip"
              onClick={() => onSelectRelated(k)}
            >
              <Icon name="search" style={{ width: 12, height: 12, marginRight: "0.25rem", color: "var(--np-accent-strong)" }} />
              {k}
            </Button>
          ))}
        </footer>
      )}
    </Card>
  );
}


