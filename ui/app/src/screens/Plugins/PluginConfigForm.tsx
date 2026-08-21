import React, { useState, useEffect } from "react";
import type { PluginDescriptor } from "@netpulse/contract";
import { Button } from "@netpulse/components";
import { Icon } from "../../icons";

export interface PluginConfigFormProps {
  plugin: PluginDescriptor;
  onSave: (config: any) => Promise<void>;
  onReset: () => Promise<void>;
  busy: boolean;
}

export function PluginConfigForm({ plugin, onSave, onReset, busy }: PluginConfigFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [showJsonMode, setShowJsonMode] = useState(false);
  const [rawJsonStr, setRawJsonStr] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [maskedFields, setMaskedFields] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const initialConfig = plugin.config && typeof plugin.config === "object" ? plugin.config : {};
    setFormData(initialConfig);
    setRawJsonStr(JSON.stringify(initialConfig, null, 2));

    // Initialize secret masking
    const initialMasked: Record<string, boolean> = {};
    if (plugin.config_schema && plugin.config_schema.properties) {
      Object.keys(plugin.config_schema.properties).forEach((prop) => {
        const meta = plugin.config_schema.properties[prop];
        if (
          meta?.storage_class === "secret" ||
          meta?.storage_class === "credential" ||
          meta?.storage_class === "token" ||
          /secret|key|token|password/i.test(prop)
        ) {
          initialMasked[prop] = true;
        }
      });
    }
    setMaskedFields(initialMasked);
  }, [plugin.config, plugin.config_schema]);

  const handleChange = (key: string, value: any) => {
    const updated = { ...formData, [key]: value };
    setFormData(updated);
    setRawJsonStr(JSON.stringify(updated, null, 2));
    setJsonError(null);
  };

  const handleRawJsonChange = (str: string) => {
    setRawJsonStr(str);
    try {
      const parsed = JSON.parse(str);
      setFormData(parsed);
      setJsonError(null);
    } catch (e: any) {
      setJsonError(e.message || "Invalid JSON syntax");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (jsonError) return;
    await onSave(formData);
  };

  const handleExport = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(formData, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${plugin.name}-config.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    if (e.target.files && e.target.files[0]) {
      fileReader.readAsText(e.target.files[0], "UTF-8");
      fileReader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target?.result as string);
          setFormData(parsed);
          setRawJsonStr(JSON.stringify(parsed, null, 2));
          setJsonError(null);
        } catch (err: any) {
          setJsonError("Import failed: Invalid JSON file");
        }
      };
    }
  };

  const schemaProperties = plugin.config_schema?.properties || {};
  const propertyKeys = Array.from(
    new Set([...Object.keys(schemaProperties), ...Object.keys(formData)])
  );

  return (
    <div style={{ marginTop: "1rem", borderTop: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.08))", paddingTop: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          style={{
            background: "none",
            border: "none",
            color: "var(--np-accent, #60a5fa)",
            fontSize: "0.85rem",
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
            padding: 0,
          }}
        >
          <Icon name="settings" style={{ width: "14px", height: "14px" }} />
          <span>{isOpen ? "Hide Configuration" : "Configure Plugin"} (v{plugin.config_version})</span>
        </button>

        {isOpen && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={() => setShowJsonMode(!showJsonMode)}
              style={{
                background: "rgba(255, 255, 255, 0.06)",
                border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.1))",
                borderRadius: "4px",
                color: "var(--np-subtext, #94a3b8)",
                fontSize: "0.75rem",
                padding: "0.2rem 0.5rem",
                cursor: "pointer",
              }}
            >
              {showJsonMode ? "Form View" : "Raw JSON"}
            </button>
            <button
              type="button"
              onClick={() => setShowDiff(!showDiff)}
              style={{
                background: "rgba(255, 255, 255, 0.06)",
                border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.1))",
                borderRadius: "4px",
                color: "var(--np-subtext, #94a3b8)",
                fontSize: "0.75rem",
                padding: "0.2rem 0.5rem",
                cursor: "pointer",
              }}
            >
              {showDiff ? "Hide Diff" : "Show Diff"}
            </button>
          </div>
        )}
      </div>

      {isOpen && (
        <form onSubmit={handleSubmit} style={{ marginTop: "1rem", background: "rgba(0,0,0,0.2)", padding: "1rem", borderRadius: "8px" }}>
          {showDiff && (
            <div style={{ marginBottom: "1rem", padding: "0.75rem", background: "rgba(0, 0, 0, 0.4)", borderRadius: "6px", fontFamily: "monospace", fontSize: "0.8rem" }}>
              <div style={{ color: "#94a3b8", fontWeight: "bold", marginBottom: "0.25rem" }}>Live vs Raw Diff</div>
              <div style={{ color: "#10b981" }}>Current: {JSON.stringify(plugin.config)}</div>
              <div style={{ color: "#60a5fa" }}>Pending: {JSON.stringify(formData)}</div>
            </div>
          )}

          {showJsonMode ? (
            <div>
              <textarea
                value={rawJsonStr}
                onChange={(e) => handleRawJsonChange(e.target.value)}
                rows={8}
                style={{
                  width: "100%",
                  background: "#0d1117",
                  color: "#e6edf3",
                  fontFamily: "monospace",
                  fontSize: "0.85rem",
                  border: jsonError ? "1px solid #ef4444" : "1px solid #30363d",
                  borderRadius: "6px",
                  padding: "0.75rem",
                  boxSizing: "border-box",
                }}
              />
              {jsonError && (
                <div style={{ color: "#ef4444", fontSize: "0.8rem", marginTop: "0.25rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <Icon name="alertTriangle" style={{ width: "13px", height: "13px" }} />
                  <span>{jsonError}</span>
                </div>
              )}
            </div>
          ) : propertyKeys.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: "0.85rem", fontStyle: "italic" }}>
              No configuration properties defined for this plugin.
            </div>
          ) : (
            <div style={{ display: "grid", gap: "0.85rem" }}>
              {propertyKeys.map((key) => {
                const schema = schemaProperties[key] || {};
                const value = formData[key] !== undefined ? formData[key] : schema.default ?? "";
                const isSecret = maskedFields[key];

                return (
                  <div key={key} style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--np-text, #e2e8f0)" }}>
                        {key} {schema.type && <span style={{ color: "#64748b", fontWeight: "normal" }}>({schema.type})</span>}
                      </label>
                      {isSecret && (
                        <button
                          type="button"
                          onClick={() => setMaskedFields({ ...maskedFields, [key]: !maskedFields[key] })}
                          style={{ background: "none", border: "none", color: "#60a5fa", fontSize: "0.75rem", cursor: "pointer" }}
                        >
                          {maskedFields[key] ? "Show Secret" : "Mask Secret"}
                        </button>
                      )}
                    </div>

                    {schema.type === "boolean" ? (
                      <input
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(e) => handleChange(key, e.target.checked)}
                        style={{ alignSelf: "flex-start", cursor: "pointer" }}
                      />
                    ) : schema.type === "integer" || schema.type === "number" ? (
                      <input
                        type="number"
                        value={value}
                        min={schema.minimum}
                        max={schema.maximum}
                        onChange={(e) => handleChange(key, schema.type === "integer" ? parseInt(e.target.value, 10) : parseFloat(e.target.value))}
                        style={{
                          background: "var(--np-surface-1, #131b2a)",
                          border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.15))",
                          borderRadius: "4px",
                          color: "#fff",
                          padding: "0.4rem 0.6rem",
                          fontSize: "0.85rem",
                        }}
                      />
                    ) : (
                      <input
                        type={isSecret ? "password" : "text"}
                        value={typeof value === "object" ? JSON.stringify(value) : value}
                        onChange={(e) => handleChange(key, e.target.value)}
                        style={{
                          background: "var(--np-surface-1, #131b2a)",
                          border: "1px solid var(--np-surface-2, rgba(255, 255, 255, 0.15))",
                          borderRadius: "4px",
                          color: "#fff",
                          padding: "0.4rem 0.6rem",
                          fontSize: "0.85rem",
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              <button
                type="button"
                onClick={handleExport}
                style={{
                  background: "rgba(255, 255, 255, 0.06)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "4px",
                  color: "#94a3b8",
                  fontSize: "0.75rem",
                  padding: "0.3rem 0.6rem",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.3rem",
                }}
              >
                <Icon name="download" style={{ width: "12px", height: "12px" }} />
                <span>Export</span>
              </button>
              <label
                style={{
                  background: "rgba(255, 255, 255, 0.06)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "4px",
                  color: "#94a3b8",
                  fontSize: "0.75rem",
                  padding: "0.3rem 0.6rem",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.3rem",
                }}
              >
                <Icon name="upload" style={{ width: "12px", height: "12px" }} />
                <span>Import</span>
                <input type="file" accept=".json" onChange={handleImport} style={{ display: "none" }} />
              </label>
            </div>

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <Button type="button" variant="standard" disabled={busy} onClick={onReset}>
                Restore Defaults
              </Button>
              <Button type="submit" variant="primary" disabled={busy || Boolean(jsonError)} busy={busy}>
                Save Config
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
