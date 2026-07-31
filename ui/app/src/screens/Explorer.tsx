// Protocol Explorer — the interactive reference (docs/15). A place to understand
// any field NetPulse dissects, on demand, at your level — "no dead ends"
// (docs/01 E1). It is a pure presenter of the explanation-key content (docs/15
// §12): browse everything, or search by a beginner's words ("padlock",
// "connection refused", "not found") and reach the precise entry (docs/15 §8).
// Content is layered by disclosure mode, but any entry can be expanded to expert
// without leaving Beginner mode globally (the escape hatch, docs/09 §6.3).

import { useEffect, useState } from "react";
import type { ExplorerEntry, ProjectionDepth } from "@netpulse/contract";
import { EmptyState, Notice, Spinner } from "@netpulse/components";
import { query } from "../ipc";
import { useDisclosure } from "../modes/DisclosureContext";

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function contentAt(entry: ExplorerEntry, depth: ProjectionDepth): string {
  if (depth === "expert") return entry.expert;
  if (depth === "intermediate") return entry.intermediate;
  return entry.beginner;
}

function Entry({ entry, depth }: { entry: ExplorerEntry; depth: ProjectionDepth }) {
  return (
    <article className="np-ref">
      <header className="np-ref__key">
        {entry.title}
        <code className="np-ref__id">{entry.key}</code>
        {entry.examples_available && <span className="np-ref__mine">you have an example</span>}
      </header>
      <p className="np-ref__body">{contentAt(entry, depth)}</p>
      {depth !== "expert" && (
        <details className="np-ref__more">
          <summary>Expert detail</summary>
          <p>{entry.expert}</p>
        </details>
      )}
      {entry.related.length > 0 && (
        <footer className="np-ref__related">
          {entry.related.map((k) => (
            <code key={k}>{k}</code>
          ))}
        </footer>
      )}
    </article>
  );
}

export function Explorer() {
  const { depth } = useDisclosure();
  const [term, setTerm] = useState("");
  const [entries, setEntries] = useState<ExplorerEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const q =
      term.trim().length > 0
        ? ({ kind: "explorerSearch", term } as const)
        : ({ kind: "explorerBrowse" } as const);
    query(q)
      .then((res) => {
        if (!cancelled && res.kind === "explorerEntries") setEntries(res.entries);
      })
      .catch((e) => {
        if (!cancelled) setNotice(toErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [term]);

  return (
    <section className="np-explorer" aria-label="Protocol Explorer">
      <Notice message={notice} onDismiss={() => setNotice(null)} />
      <input
        className="np-explorer__search"
        type="search"
        placeholder="Search: padlock, RST, NXDOMAIN, 404…"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        aria-label="Search the protocol reference"
      />
      {!loaded ? (
        <Spinner />
      ) : entries.length === 0 ? (
        <EmptyState>No matching entry — try another word.</EmptyState>
      ) : (
        entries.map((entry) => <Entry key={entry.key} entry={entry} depth={depth} />)
      )}
    </section>
  );
}
