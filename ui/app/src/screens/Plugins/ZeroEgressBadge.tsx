import { useTranslation } from "react-i18next";

export function ZeroEgressBadge() {
  const { t } = useTranslation(["plugins"]);

  return (
    <div className="np-plugins__privacy-badge">
      <div className="np-plugins__privacy-badge-title">
        {t("zero_egress_badge")}
      </div>
    </div>
  );
}

