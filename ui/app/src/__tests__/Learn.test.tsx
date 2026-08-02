import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { Learn } from "../screens/Learn";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { __resetForTest } from "../state/store";
import * as ipcModule from "../ipc";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function LearnTestWrapper() {
  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <Learn />
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

describe("Learn Screen & useLearnController", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("renders lesson offers from fallback baseline session when store feed is empty", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "lessonOffers",
      offers: [
        {
          lesson_id: "dns-basics",
          title: "Understanding DNS Lookup Latency",
          level: "beginner",
          grounded: true,
          grounding: ["DNS query to api.github.com took 42ms."],
          exercise: {
            prompt: "What protocol was used for domain resolution?",
            answer: "UDP port 53 / DNS over HTTPS.",
          },
          evidence: [{ id: "pkt-10", kind: "packet", label: "Packet #10" }],
        },
      ],
    } as any);

    render(<LearnTestWrapper />);

    expect(await screen.findByText("Understanding DNS Lookup Latency")).toBeInTheDocument();
    expect(screen.getAllByText("Beginner")[0]).toBeInTheDocument();
    expect(screen.getByText("🎯 Grounded Capture")).toBeInTheDocument();
    expect(screen.getByText("DNS query to api.github.com took 42ms.")).toBeInTheDocument();
  });

  it("filters lessons by level chip selection", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "lessonOffers",
      offers: [
        {
          lesson_id: "dns-basics",
          title: "DNS Lookup Latency",
          level: "beginner",
          grounded: true,
          grounding: [],
          evidence: [],
        },
        {
          lesson_id: "tls-handshake",
          title: "TLS 1.3 Handshake Inspection",
          level: "advanced",
          grounded: false,
          grounding: [],
          evidence: [],
        },
      ],
    } as any);

    render(<LearnTestWrapper />);

    expect(await screen.findByText("DNS Lookup Latency")).toBeInTheDocument();
    expect(screen.getByText("TLS 1.3 Handshake Inspection")).toBeInTheDocument();

    // Click "Beginner" filter chip
    const beginnerChip = screen.getByRole("button", { name: "Beginner" });
    fireEvent.click(beginnerChip);

    expect(screen.getByText("DNS Lookup Latency")).toBeInTheDocument();
    expect(screen.queryByText("TLS 1.3 Handshake Inspection")).not.toBeInTheDocument();
  });

  it("renders exercise prompt and reveals answer when check details is expanded", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "lessonOffers",
      offers: [
        {
          lesson_id: "http3-quic",
          title: "HTTP/3 & QUIC Transport",
          level: "intermediate",
          grounded: true,
          grounding: [],
          exercise: {
            prompt: "Why does QUIC eliminate head-of-line blocking?",
            answer: "QUIC multiplexes streams independently over UDP datagrams.",
          },
          evidence: [],
        },
      ],
    } as any);

    render(<LearnTestWrapper />);

    expect(await screen.findByText("HTTP/3 & QUIC Transport")).toBeInTheDocument();
    expect(screen.getByText(/Why does QUIC eliminate head-of-line blocking\?/)).toBeInTheDocument();
    expect(screen.getByText("💡 QUIC multiplexes streams independently over UDP datagrams.")).toBeInTheDocument();
  });
});
