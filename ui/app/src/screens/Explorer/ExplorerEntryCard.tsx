import { useTranslation } from "react-i18next";
import type { ExplorerEntry, ProjectionDepth } from "@netpulse/contract";
import { Badge, Button, Card } from "@netpulse/components";
import { Icon } from "../../icons";

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

        {entry.examples_available && (
          <Badge variant="trust" className="np-ref__mine">
            🎯 {t("card.example_tag")}
          </Badge>
        )}
      </header>

      {/* Main explanation body */}
      <p className="np-ref__body">
        {contentAt(entry, depth)}
      </p>

      {/* Collapsible Expert Detail */}
      {depth !== "expert" && entry.expert && (
        <details className="np-ref__more">
          <summary>
            🔬 {t("card.expert_detail")}
          </summary>
          <p className="np-ref__more-content">
            {entry.expert}
          </p>
        </details>
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

