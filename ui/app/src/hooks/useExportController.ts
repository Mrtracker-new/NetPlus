import { useState, useEffect, useCallback, useRef } from "react";
import type {
  ExportArtifact,
  ExportFormat,
  ExportPreview,
  PayloadLevel,
} from "@netpulse/contract";
import { query, command } from "../ipc";

export type ExportStatus =
  | "idle"
  | "loading-preview"
  | "preview-ready"
  | "exporting"
  | "completed"
  | "failed";

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

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
  // The file this session actually wrote. "An export happened" is not actionable;
  // the path is, so it is kept and shown (and can be opened).
  const [artifact, setArtifact] = useState<ExportArtifact | null>(null);
  const [opening, setOpening] = useState(false);

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
      const result = await command({
        kind: "startExport",
        selection: { kind: "all" },
        format,
        level,
      });
      setStatus("completed");
      if (result && result.kind === "artifactWritten") {
        setArtifact(result.artifact);
        setNotice(
          `Export written to ${result.artifact.path} (${humanBytes(
            result.artifact.bytes
          )}). Sharing is a separate, explicit action.`
        );
        setAnnouncement("Export completed; the file is on disk.");
      } else {
        // No artifact reported: say only what is known rather than naming a file.
        setArtifact(null);
        setNotice(
          "Export command completed, but no file path was reported. Sharing is a separate, explicit action."
        );
        setAnnouncement("Export completed without a reported file.");
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setStatus("failed");
      setNotice(errMsg);
      setAnnouncement(`Export failed: ${errMsg}`);
    } finally {
      setBusy(false);
    }
  }, [format, level]);

  /**
   * Ask the shell to hand the written file to the OS. The shell resolves the
   * session-scoped artifact id against the files it wrote, so this action can
   * never open an arbitrary path.
   */
  const openArtifact = useCallback(async () => {
    if (!artifact) return;
    setOpening(true);
    setNotice(null);
    try {
      const result = await command({ kind: "openExport", id: artifact.id });
      if (result && result.kind === "artifactOpened") {
        setNotice(`Opened ${result.artifact.path} with your system's handler.`);
        setAnnouncement("Export opened.");
      } else {
        setNotice("The open command completed without confirming the file was opened.");
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setNotice(errMsg);
      setAnnouncement(`Could not open the export: ${errMsg}`);
    } finally {
      setOpening(false);
    }
  }, [artifact]);

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
    openArtifact,
    artifact,
    opening,
    announcement,
  };
}
