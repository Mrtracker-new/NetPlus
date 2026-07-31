// Plugins — the extension seams that let the community add protocols, detectors,
// enrichments, views, and export formats without forking (docs/24). Each plugin
// hooks at one layer boundary and is bounded to that seam's capabilities (docs/24
// §3, §5). The trust model is conservative and visible: every plugin shows its
// type, granted capabilities, trust/review status, and contract compatibility, so
// enabling one is an informed, explicit choice (docs/24 §5). Crucially, **no
// plugin type can acquire network/egress capability** — that variant does not
// exist in the model, keeping the privacy guarantee auditable (docs/24 §5).

import { useEffect, useState } from "react";
import type { PluginDescriptor } from "@netpulse/contract";
import { EmptyState, Notice, Spinner } from "@netpulse/components";
import { query, command } from "../ipc";

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const TYPE_LABEL: Record<PluginDescriptor["plugin_type"], string> = {
  dissector: "Dissector · decode",
  enrichment: "Enrichment · local metadata",
  detector: "Detector · intelligence",
  view: "View · presentation",
  export: "Export · output format",
};

const TRUST_LABEL: Record<PluginDescriptor["trust"], string> = {
  unreviewed: "Unreviewed",
  reviewed: "Reviewed",
  first_party: "First-party",
};

function PluginRow({
  p,
  busy,
  onToggle,
}: {
  p: PluginDescriptor;
  busy: boolean;
  onToggle: (enable: boolean) => void;
}) {
  return (
    <article className={p.enabled ? "np-plugin np-plugin--on" : "np-plugin"}>
      <header className="np-plugin__head">
        <span className="np-plugin__name">{p.name}</span>
        <span className="np-plugin__type">{TYPE_LABEL[p.plugin_type]}</span>
        <span className={`np-plugin__trust np-plugin__trust--${p.trust}`}>
          {TRUST_LABEL[p.trust]}
        </span>
      </header>

      <div className="np-plugin__caps">
        {p.capabilities.map((c) => (
          <span key={c} className="np-plugin__cap">
            {c.replace(/_/g, " ")}
          </span>
        ))}
      </div>

      <div className="np-plugin__meta">
        <span>contract v{p.target_contract}</span>
        <span>{p.compatible ? "compatible" : "incompatible"}</span>
        {p.disabled_reason && <span className="np-plugin__reason">{p.disabled_reason}</span>}
      </div>

      <footer className="np-plugin__foot">
        <span className="np-plugin__source">{p.source}</span>
        <button
          className="np-btn"
          disabled={busy || (!p.compatible && !p.enabled)}
          onClick={() => onToggle(!p.enabled)}
        >
          {busy ? "Updating…" : p.enabled ? "Disable" : "Enable"}
        </button>
      </footer>
    </article>
  );
}

export function Plugins() {
  const [plugins, setPlugins] = useState<PluginDescriptor[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);

  function refresh() {
    query({ kind: "listPlugins" })
      .then((res) => setPlugins(res.kind === "plugins" ? res.plugins : []))
      .catch((e) => {
        setPlugins([]);
        setNotice(toErrorMessage(e));
      })
      .finally(() => setLoaded(true));
  }

  useEffect(refresh, []);

  async function toggle(name: string, enable: boolean) {
    if (busyName !== null) return;
    setNotice(null);
    setBusyName(name);
    try {
      await command({ kind: enable ? "enablePlugin" : "disablePlugin", name });
      refresh();
    } catch (e) {
      setNotice(toErrorMessage(e));
    } finally {
      setBusyName(null);
    }
  }

  return (
    <section className="np-plugins" aria-label="Plugins">
      <Notice message={notice} onDismiss={() => setNotice(null)} />
      <p className="np-plugins__note">
        Plugins extend NetPulse at defined seams. Each is capability-bounded by its
        type, and no plugin can reach the network — the single egress boundary stays
        the AI assistant (docs/24 §5).
      </p>

      {!loaded ? (
        <Spinner />
      ) : plugins.length === 0 ? (
        <EmptyState>No plugins registered.</EmptyState>
      ) : (
        plugins.map((p) => (
          <PluginRow
            key={p.name}
            p={p}
            busy={busyName === p.name}
            onToggle={(enable) => void toggle(p.name, enable)}
          />
        ))
      )}
    </section>
  );
}
