import { useTranslation } from "react-i18next";
import { useStore } from "../../state/store";

export function SessionCard() {
  const { t } = useTranslation("common");
  const { monitor, feed } = useStore();

  const totalFlows = monitor?.by_host.rows.reduce((s, r) => s + r.flows, 0) ?? 0;

  return (
    <section className="np-rail-card">
      <h2 className="np-rail-card__title">{t("rail.this_session")}</h2>
      <ul className="np-rail-list">
        <li>
          {t("rail.hosts_observed")}
          <span className="np-rail-list__val">{monitor?.by_host.rows.length ?? 0}</span>
        </li>
        <li>
          {t("rail.active_flows")}
          <span className="np-rail-list__val">{totalFlows}</span>
        </li>
        <li>
          {t("rail.narrative_cards")}
          <span className="np-rail-list__val">{feed.length}</span>
        </li>
        <li>
          {t("rail.capture_drops")}
          <span className="np-rail-list__val">{monitor?.capture_drops ?? 0}</span>
        </li>
      </ul>
    </section>
  );
}
