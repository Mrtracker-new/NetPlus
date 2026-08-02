import { useState, useEffect, useCallback, useRef } from "react";
import type { ExportFormat, ExportPreview, PayloadLevel } from "@netpulse/contract";
import { query, command } from "../ipc";

export type ExportStatus =
  | "idle"
  | "loading-preview"
  | "preview-ready"
  | "exporting"
  | "completed"
  | "failed";

function formatProvenance(rawProvenance: string, level: PayloadLevel): string {
  const formattedLevel =
    level === "metadata_only" ? "metadata-only" : level === "headers" ? "headers" : "full-payload";

  if (rawProvenance.includes(" · ")) {
    const prefix = rawProvenance.split(" · ")[0];
    return `${prefix} · ${formattedLevel}`;
  }
  return `NetPulse 0.1.0 · ${formattedLevel}`;
}

function formatSanitizedRules(rawRules: string[], level: PayloadLevel): string[] {
  const levelRule =
    level === "full_payload"
      ? "full payload: packet payloads included"
      : level === "headers"
      ? "headers only: transport & IP headers included, application body stripped"
      : "metadata-only: no packet payloads leave";

  const filtered = rawRules.filter(
    (rule) =>
      !rule.startsWith("metadata-only") &&
      !rule.startsWith("headers only") &&
      !rule.startsWith("full payload")
  );

  return [levelRule, ...filtered];
}

export function useExportController() {
  const [format, setFormatState] = useState<ExportFormat>("json");
  const [level, setLevelState] = useState<PayloadLevel>("metadata_only");
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [status, setStatus] = useState<ExportStatus>("idle");

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const cacheRef = useRef<Map<string, ExportPreview>>(new Map());

  const fetchPreview = useCallback(async (fmt: ExportFormat, lvl: PayloadLevel) => {
    const cacheKey = `${fmt}:${lvl}`;
    if (cacheRef.current.has(cacheKey)) {
      setPreview(cacheRef.current.get(cacheKey)!);
      setStatus("preview-ready");
      return;
    }

    setStatus("loading-preview");
    setNotice(null);

    try {
      const res = await query({ kind: "exportPreview", selection: { kind: "all" }, format: fmt });
      if (res.kind === "exportPreview") {
        const rawPreview = res.preview;

        const enrichedPreview: ExportPreview = {
          ...rawPreview,
          level: lvl,
          contains_payloads: lvl === "full_payload",
          provenance: formatProvenance(rawPreview.provenance, lvl),
          sanitized: formatSanitizedRules(rawPreview.sanitized, lvl),
        };

        cacheRef.current.set(cacheKey, enrichedPreview);
        setPreview(enrichedPreview);
        setStatus("preview-ready");
        setAnnouncement(`Loaded export preview for ${fmt} format.`);
      } else {
        setPreview(null);
        setStatus("idle");
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setPreview(null);
      setStatus("failed");
      setNotice(errMsg);
      setAnnouncement(`Failed to load preview: ${errMsg}`);
    }
  }, []);

  useEffect(() => {
    void fetchPreview(format, level);
  }, [fetchPreview, format, level]);

  const setFormat = useCallback((fmt: ExportFormat) => {
    setFormatState(fmt);
  }, []);

  const setLevel = useCallback((lvl: PayloadLevel) => {
    setLevelState(lvl);
    setPreview((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        level: lvl,
        contains_payloads: lvl === "full_payload",
        provenance: formatProvenance(prev.provenance, lvl),
        sanitized: formatSanitizedRules(prev.sanitized, lvl),
      };
    });
  }, []);

  const startExport = useCallback(async () => {
    setNotice(null);
    setBusy(true);
    setStatus("exporting");
    setAnnouncement(`Started export for ${format} format...`);
    try {
      await command({ kind: "startExport", selection: { kind: "all" }, format, level });
      setStatus("completed");
      setNotice("Export written locally to disk. Sharing is a separate, explicit action.");
      setAnnouncement("Export completed successfully.");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setStatus("failed");
      setNotice(errMsg);
      setAnnouncement(`Export failed: ${errMsg}`);
    } finally {
      setBusy(false);
    }
  }, [format, level]);

  return {
    format,
    setFormat,
    level,
    setLevel,
    preview,
    status,
    busy,
    notice,
    setNotice,
    startExport,
    announcement,
  };
}
