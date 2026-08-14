import React from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../../state/store";
import { humanBytes, primaryHostName } from "@netpulse/viz";

export function TopHostsCard() {
  const { t } = useTranslation("common");
  const { monitor } = useStore();
  const hosts = monitor
    ? [...monitor.by_host.rows].sort((a, b) => b.bytes - a.bytes).slice(0, 6)
    : [];
  const maxBytes = hosts.length > 0 ? Math.max(...hosts.map((h) => h.bytes), 1) : 1;

  return (
    <section className="np-rail-card">
      <h2 className="np-rail-card__title">{t("rail.top_hosts")}</h2>
      {hosts.length === 0 ? (
        <p className="np-cons__hint">{t("rail.quiet_no_hosts")}</p>
      ) : (
        <ul className="np-rail-list np-rail-list--hosts">
          {hosts.map((h) => {
            const nm = primaryHostName(h);
            const pct = Math.min(100, Math.max(8, Math.round((h.bytes / maxBytes) * 100)));
            return (
              <li key={h.label} className="np-rail-host-item" style={{ "--host-pct": `${pct}%` } as React.CSSProperties}>
                <span
                  className="np-rail-host-name"
                  title={nm ? `${nm.name} · ${h.label}` : h.label}
                >
                  {nm ? nm.name : h.label}
                </span>
                <span className="np-rail-list__val">{humanBytes(h.bytes)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
