import { useTranslation } from "react-i18next";

export function ZeroEgressBadge() {
  const { t } = useTranslation(["plugins"]);

  return (
    <div
      className="np-plugins__privacy-badge"
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
      </div>
    </div>
  );
}
