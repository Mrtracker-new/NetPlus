import { useState, useCallback } from "react";
import type { DiagnosticSeverity, PacketInspection } from "@netpulse/contract";
import { query } from "../ipc";

export const AVAILABLE_LAYERS = [
  "Ethernet",
  "IPv4",
  "IPv6",
  "TCP",
  "UDP",
  "DNS",
  "TLS 1.3",
  "HTTP/1.1",
  "HTTP/2",
  "HTTP/3",
  "QUIC",
  "ICMP",
];

export const PRESETS: Record<string, string[]> = {
  http1: ["Ethernet", "IPv4", "TCP", "HTTP/1.1"],
  http3: ["Ethernet", "IPv6", "UDP", "QUIC", "HTTP/3"],
  dns: ["Ethernet", "IPv4", "UDP", "DNS"],
  tls: ["Ethernet", "IPv4", "TCP", "TLS 1.3", "HTTP/2"],
  icmp: ["Ethernet", "IPv4", "ICMP"],
};

function normalizeSeverity(value: string): DiagnosticSeverity {
  switch (value.toLowerCase()) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    default:
      return "info";
  }
}

/** Formats raw hex string into Wireshark offset hex dump rows */
export function formatHexDump(rawHex: string): Array<{ offset: string; hexBytes: string; ascii: string }> {
  if (!rawHex) return [];
  const cleanHex = rawHex.replace(/\s+/g, "");
  const rows: Array<{ offset: string; hexBytes: string; ascii: string }> = [];

  for (let i = 0; i < cleanHex.length; i += 32) {
    const chunk = cleanHex.slice(i, i + 32);
    const offset = i / 2;
    const offsetHex = offset.toString(16).padStart(4, "0").toUpperCase();

    const bytes: string[] = [];
    let ascii = "";

    for (let j = 0; j < chunk.length; j += 2) {
      const byteHex = chunk.slice(j, j + 2);
      bytes.push(byteHex);
      const code = parseInt(byteHex, 16);
      ascii += code >= 32 && code <= 126 ? String.fromCharCode(code) : ".";
    }

    rows.push({
      offset: offsetHex,
      hexBytes: bytes.join(" "),
      ascii,
    });
  }

  return rows;
}

export function useSandboxController() {
  const [layers, setLayers] = useState<string[]>(PRESETS.http1!);
  const [selectedLayerToAdd, setSelectedLayerToAdd] = useState<string>(AVAILABLE_LAYERS[0]!);
  const [inspection, setInspection] = useState<PacketInspection | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const inspectPacket = useCallback(
    async (targetLayers?: string[]) => {
      setNotice(null);
      setToast(null);
      setIsBuilding(true);
      const stack = targetLayers ?? layers;
      setAnnouncement(`Building packet for stack: ${stack.join(" -> ")}...`);

      try {
        const res = await query({ kind: "buildAndDecodePacket", layers: stack });
        if (res.kind === "decodedPacketInspection") {
          const raw = res.inspection;
          const normalized: PacketInspection = {
            rawHex: raw.rawHex,
            layers: raw.layers,
            diagnostics: raw.diagnostics.map((d) => ({
              ...d,
              severity: normalizeSeverity(d.severity),
            })),
          };
          setInspection(normalized);
          setAnnouncement(`Packet built cleanly with ${normalized.diagnostics.length} RFC diagnostics.`);
        } else {
          setNotice("Unexpected response kind from backend.");
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        setNotice(errMsg);
        setAnnouncement(`Failed to build packet: ${errMsg}`);
      } finally {
        setIsBuilding(false);
      }
    },
    [layers]
  );

  const addLayer = useCallback(() => {
    if (!selectedLayerToAdd) return;
    setLayers((prev) => [...prev, selectedLayerToAdd]);
    setAnnouncement(`Added layer ${selectedLayerToAdd}`);
  }, [selectedLayerToAdd]);

  const removeLayer = useCallback((index: number) => {
    setLayers((prev) => {
      if (prev.length <= 1) return prev; // Keep at least 1 layer
      const next = [...prev];
      const removed = next.splice(index, 1);
      setAnnouncement(`Removed layer ${removed[0]}`);
      return next;
    });
  }, []);

  const moveLayer = useCallback((index: number, direction: "up" | "down") => {
    setLayers((prev) => {
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const temp = next[index]!;
      next[index] = next[targetIndex]!;
      next[targetIndex] = temp;
      return next;
    });
  }, []);

  const loadPreset = useCallback(
    (presetKey: string) => {
      const presetLayers = PRESETS[presetKey];
      if (presetLayers) {
        setLayers(presetLayers);
        void inspectPacket(presetLayers);
      }
    },
    [inspectPacket]
  );

  const copyHex = useCallback(() => {
    if (!inspection?.rawHex) return;
    navigator.clipboard.writeText(inspection.rawHex);
    setToast("copied_hex");
    setTimeout(() => setToast(null), 3000);
  }, [inspection?.rawHex]);

  const copyJson = useCallback(() => {
    if (!inspection) return;
    navigator.clipboard.writeText(JSON.stringify(inspection, null, 2));
    setToast("copied_json");
    setTimeout(() => setToast(null), 3000);
  }, [inspection]);

  const resetStack = useCallback(() => {
    setLayers(PRESETS.http1!);
    setInspection(null);
    setNotice(null);
    setToast(null);
    setAnnouncement("Layer stack reset to default HTTP/1.1.");
  }, []);

  return {
    layers,
    setLayers,
    selectedLayerToAdd,
    setSelectedLayerToAdd,
    inspection,
    isBuilding,
    notice,
    setNotice,
    toast,
    setToast,
    announcement,
    actions: {
      inspectPacket,
      addLayer,
      removeLayer,
      moveLayer,
      loadPreset,
      copyHex,
      copyJson,
      resetStack,
    },
  };
}
