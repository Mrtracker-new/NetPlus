import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FleetHost } from "@netpulse/contract";
import { Badge, Spinner, Notice, EmptyState } from "@netpulse/components";
import { query } from "../ipc";
import { useDisclosure } from "../modes/DisclosureContext";

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function FleetScreen() {
  const { t } = useTranslation(["fleet", "common"]);
  const [hosts, setHosts] = useState<FleetHost[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { shows } = useDisclosure();

  useEffect(() => {
    let cancelled = false;
    query({ kind: "listFleetHosts" })
      .then((res) => {
        if (cancelled) return;
        if (res.kind === "fleetHosts") {
          setHosts(res.hosts);
        } else {
          setHosts([]);
          setNotice("Unexpected response kind from backend.");
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setHosts([]);
          setNotice(toErrorMessage(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="np-fleet" aria-label={t("title")}>
      <h2>{t("title")}</h2>
      <p className="np-fleet__desc">{t("desc")}</p>

      {notice && <Notice message={notice} level="error" onDismiss={() => setNotice(null)} />}

      {!loaded ? (
        <Spinner />
      ) : hosts.length === 0 ? (
        <EmptyState>{t("empty")}</EmptyState>
      ) : (
        <div className="np-fleet__grid" role="list">
          {hosts.map((h) => (
            <article className="np-fleet__node" key={h.hostId} role="listitem">
              <div>
                <strong className="np-fleet__name">{h.friendlyName || h.hostname}</strong> ({h.os} / {h.platform})
                <p className="np-fleet__meta">
                  {shows("intermediate") && `Agent ID: ${h.hostId} | `}
                  Version: {h.agentVersion}
                </p>
              </div>
              <div>
                <Badge variant="kind" aria-label={`Status: ${h.status}`}>
                  {h.status}
                </Badge>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
