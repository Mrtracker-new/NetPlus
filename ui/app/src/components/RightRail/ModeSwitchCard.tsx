import { useTranslation } from "react-i18next";
import { useDisclosure, DEPTHS } from "../../modes/DisclosureContext";
import type { ProjectionDepth } from "@netpulse/contract";

export function ModeSwitchCard() {
  const { t } = useTranslation("common");
  const { depth, setDepth } = useDisclosure();

  return (
    <section className="np-rail-card">
      <h2 className="np-rail-card__title">{t("rail.view_density")}</h2>
      <div className="np-modes" role="radiogroup" aria-label="Disclosure mode">
        {DEPTHS.map((d: ProjectionDepth) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={d === depth}
            title={d}
            className={d === depth ? "np-mode np-mode--active" : "np-mode"}
            onClick={() => setDepth(d)}
          >
            {d}
          </button>
        ))}
      </div>
    </section>
  );
}
