import { useTranslation } from "react-i18next";

export function ZeroEgressBadge() {
  const { t } = useTranslation(["export"]);

  return (
    <div className="np-export__privacy-badge">
      <span className="np-export__privacy-badge-icon">🔒</span>
      <div>
        <div className="np-export__privacy-badge-title">
          {t("zero_egress_badge")}
        </div>
        <div className="np-export__privacy-badge-desc">
          {t("zero_egress_notice")}
        </div>
      </div>
    </div>
  );
}

