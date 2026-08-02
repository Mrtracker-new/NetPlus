import { useTranslation } from "react-i18next";

export function ZeroEgressBadge() {
  const { t } = useTranslation(["export"]);

  return (
    <div
      className="np-export__privacy-badge"
      style={{
        background: "rgba(16, 185, 129, 0.12)",
        border: "1px solid rgba(16, 185, 129, 0.3)",
        borderRadius: "var(--np-radius-md, 8px)",
        padding: "0.85rem 1.1rem",
        marginBottom: "1.25rem",
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
      }}
    >
      <span style={{ fontSize: "1.2rem" }}>🔒</span>
      <div>
        <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "#10b981" }}>
          {t("zero_egress_badge")}
        </div>
        <div style={{ fontSize: "0.82rem", color: "var(--np-subtext, #94a3b8)", marginTop: "0.2rem" }}>
          {t("zero_egress_notice")}
        </div>
      </div>
    </div>
  );
}
