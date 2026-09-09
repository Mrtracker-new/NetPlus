import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { humanBytes, type TopologyNode, type TopologyEdge } from "@netpulse/viz";
import {
  ApplicationsLineageCard,
  findMatchingLineage,
  type FlowLineageDto,
} from "../screens/Monitoring/ApplicationsLineageCard";
import { setMonitor, __resetForTest } from "../state/store";
import type { MonitorSnapshot } from "@netpulse/contract";

describe("ApplicationsLineageCard & findMatchingLineage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    __resetForTest();
  });

  const sampleLineage: FlowLineageDto[] = [
    {
      source: "192.168.1.100",
      destination: "1.1.1.1",
      protocol: "DNS",
      bytes: 65536,
      packets: 42,
      direction: "outbound",
      flow_count: 3,
      classification: "external_wan",
    },
    {
      source: "192.168.1.100",
      destination: "10.0.0.5",
      protocol: "TCP",
      bytes: 1048576,
      packets: 750,
      direction: "local",
      flow_count: 5,
      classification: "local_subnet",
    },
    {
      source: "192.168.1.100",
      destination: "142.250.190.46",
      protocol: "HTTPS",
      bytes: 5242880,
      packets: 3200,
      direction: "outbound",
      flow_count: 12,
      classification: "cdn_edge",
    },
  ];

  const sampleNodes: TopologyNode[] = [
    {
      id: "node-192.168.1.100",
      label: "192.168.1.100",
      sublabel: "SRC",
      status: "healthy",
      x: 100,
      y: 100,
    },
    {
      id: "node-1.1.1.1",
      label: "1.1.1.1",
      sublabel: "EXTERNAL_WAN",
      status: "healthy",
      x: 300,
      y: 100,
    },
    {
      id: "node-10.0.0.5",
      label: "10.0.0.5",
      sublabel: "LOCAL_SUBNET",
      status: "warning",
      x: 300,
      y: 200,
    },
  ];

  const sampleEdges: TopologyEdge[] = [
    {
      source: "node-192.168.1.100",
      target: "node-1.1.1.1",
      bandwidth: "64 KB",
    },
    {
      source: "node-192.168.1.100",
      target: "node-10.0.0.5",
      bandwidth: "1.0 MB",
    },
  ];

  describe("findMatchingLineage", () => {
    it("matches node by destination id with node- prefix", () => {
      const node: TopologyNode = {
        id: "node-1.1.1.1",
        label: "1.1.1.1",
        status: "healthy",
        x: 0,
        y: 0,
      };
      const match = findMatchingLineage(node, sampleLineage);
      expect(match).toBeDefined();
      expect(match?.destination).toBe("1.1.1.1");
      expect(match?.protocol).toBe("DNS");
      expect(match?.bytes).toBe(65536);
      expect(match?.classification).toBe("external_wan");
    });

    it("matches node by source id with node- prefix", () => {
      const node: TopologyNode = {
        id: "node-192.168.1.100",
        label: "192.168.1.100",
        status: "healthy",
        x: 0,
        y: 0,
      };
      const match = findMatchingLineage(node, sampleLineage);
      expect(match).toBeDefined();
      expect(match?.source).toBe("192.168.1.100");
    });

    it("matches node by bare destination IP without node- prefix", () => {
      const node: TopologyNode = {
        id: "10.0.0.5",
        label: "10.0.0.5",
        status: "healthy",
        x: 0,
        y: 0,
      };
      const match = findMatchingLineage(node, sampleLineage);
      expect(match).toBeDefined();
      expect(match?.destination).toBe("10.0.0.5");
      expect(match?.protocol).toBe("TCP");
    });

    it("matches node by label when id is custom", () => {
      const node: TopologyNode = {
        id: "custom-cdn-node",
        label: "142.250.190.46",
        status: "healthy",
        x: 0,
        y: 0,
      };
      const match = findMatchingLineage(node, sampleLineage);
      expect(match).toBeDefined();
      expect(match?.destination).toBe("142.250.190.46");
      expect(match?.classification).toBe("cdn_edge");
    });

    it("returns undefined when no matching flow exists", () => {
      const node: TopologyNode = {
        id: "node-172.16.0.1",
        label: "172.16.0.1",
        status: "healthy",
        x: 0,
        y: 0,
      };
      const match = findMatchingLineage(node, sampleLineage);
      expect(match).toBeUndefined();
    });

    it("returns undefined for empty lineage or empty node", () => {
      expect(findMatchingLineage(null as any, sampleLineage)).toBeUndefined();
      expect(findMatchingLineage(sampleNodes[0]!, [])).toBeUndefined();
    });
  });

  describe("ApplicationsLineageCard popover telemetry", () => {
    it("renders authentic classification, humanBytes(item.bytes), and real item.protocol when node is selected (via prop)", () => {
      render(
        <ApplicationsLineageCard
          nodes={sampleNodes}
          edges={sampleEdges}
          selectedNodeId="node-1.1.1.1"
          lineage={sampleLineage}
        />
      );

      // Node label and status
      expect(screen.getByText("1.1.1.1 (healthy)")).toBeInTheDocument();

      // Classification, authentic humanBytes(item.bytes), and real item.protocol
      expect(screen.getByText(/Classification: external_wan/)).toBeInTheDocument();
      expect(screen.getByText(new RegExp(humanBytes(65536)))).toBeInTheDocument();
      expect(screen.getByText(/Protocol: DNS/)).toBeInTheDocument();
      expect(screen.getByText(/• Active$/)).toBeInTheDocument();
      expect(
        screen.getByText("Classification: external_wan • 64 KB • Protocol: DNS • Active")
      ).toBeInTheDocument();
    });

    it("renders telemetry from store (useStore) when prop lineage is omitted", () => {
      const snapshot: MonitorSnapshot = {
        by_protocol: { dimension: "protocol", rows: [] },
        by_host: { dimension: "host", rows: [] },
        diagnoses: [],
        network_loss_indicators: 0,
        capture_drops: 0,
        lineage: sampleLineage,
      };
      setMonitor(snapshot);

      render(
        <ApplicationsLineageCard
          nodes={sampleNodes}
          edges={sampleEdges}
          selectedNodeId="node-10.0.0.5"
        />
      );

      // Node label and status
      expect(screen.getByText("10.0.0.5 (warning)")).toBeInTheDocument();

      // Classification, authentic humanBytes, real protocol
      expect(screen.getByText(/Classification: local_subnet/)).toBeInTheDocument();
      expect(screen.getByText(/1\.0 MB/)).toBeInTheDocument();
      expect(screen.getByText(/Protocol: TCP/)).toBeInTheDocument();
      expect(screen.getByText(/• Active$/)).toBeInTheDocument();
      expect(
        screen.getByText("Classification: local_subnet • 1.0 MB • Protocol: TCP • Active")
      ).toBeInTheDocument();
    });

    it("falls back gracefully when selected node has no matching lineage item", () => {
      const unknownNode: TopologyNode = {
        id: "node-unknown",
        label: "unknown-host",
        sublabel: "CUSTOM_SUBLABEL",
        status: "healthy",
        x: 0,
        y: 0,
      };

      render(
        <ApplicationsLineageCard
          nodes={[unknownNode]}
          edges={[]}
          selectedNodeId="node-unknown"
          lineage={sampleLineage}
        />
      );

      expect(screen.getByText("unknown-host (healthy)")).toBeInTheDocument();
      expect(screen.getByText(/Classification: CUSTOM_SUBLABEL/)).toBeInTheDocument();
      expect(screen.getByText(/Protocol: Active Flow/)).toBeInTheDocument();
      expect(screen.getByText(/• Active$/)).toBeInTheDocument();
      expect(
        screen.getByText("Classification: CUSTOM_SUBLABEL • Protocol: Active Flow • Active")
      ).toBeInTheDocument();
    });

    it("calls onSelectNode(null) when close button is clicked", () => {
      const onSelectNode = vi.fn();

      render(
        <ApplicationsLineageCard
          nodes={sampleNodes}
          edges={sampleEdges}
          selectedNodeId="node-1.1.1.1"
          onSelectNode={onSelectNode}
          lineage={sampleLineage}
        />
      );

      const closeBtn = screen.getByRole("button", { name: /close node details/i });
      fireEvent.click(closeBtn);

      expect(onSelectNode).toHaveBeenCalledTimes(1);
      expect(onSelectNode).toHaveBeenCalledWith(null);
    });
  });
});
