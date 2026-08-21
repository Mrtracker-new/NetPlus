import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../i18n";
import { Assistant } from "../screens/Assistant";
import { DisclosureProvider } from "../modes/DisclosureContext";
import { EvidenceNavigationProvider } from "../context/EvidenceNavigationContext";
import { __resetForTest } from "../state/store";
import * as ipcModule from "../ipc";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function AssistantTestWrapper() {
  return (
    <DisclosureProvider>
      <EvidenceNavigationProvider>
        <Assistant />
      </EvidenceNavigationProvider>
    </DisclosureProvider>
  );
}

describe("Assistant Screen & useAssistantController", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("renders empty capability guide when conversation history is empty", () => {
    render(<AssistantTestWrapper />);

    expect(screen.getByText("Ask NetPulse Assistant")).toBeInTheDocument();
    expect(
      screen.getByText("Query captured traffic, isolate latency causes, and audit protocol behaviors with zero data egress.")
    ).toBeInTheDocument();
  });

  it("submits prompt via input form and renders AI answer with privacy posture and citations", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "assistantAnswer",
      answer: {
        text: "The highest bandwidth host was 192.168.1.105 generating 45MB over HTTPS.",
        grounded: true,
        citations: [{ id: "flow-42", kind: "flow", label: "Flow #42" }],
        is_remote: false,
        backend_id: "llama3-local",
        disclosure: "Summary of flow #42 metadata.",
      },
    } as any);

    render(<AssistantTestWrapper />);

    const input = screen.getByPlaceholderText("Ask a question about active flows, protocols, or latency...");
    fireEvent.change(input, { target: { value: "Which host used the most bandwidth?" } });

    const askBtn = screen.getByRole("button", { name: "Ask" });
    fireEvent.click(askBtn);

    expect(await screen.findByRole("heading", { name: /Which host used the most bandwidth/i })).toBeInTheDocument();
    expect(
      screen.getByText("The highest bandwidth host was 192.168.1.105 generating 45MB over HTTPS.")
    ).toBeInTheDocument();
    expect(screen.getByText("Local (Zero Egress) · llama3-local")).toBeInTheDocument();
    expect(screen.getByText("flow #flow-42")).toBeInTheDocument();
  });

  it("submits prompt when suggestion chip is clicked", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "assistantAnswer",
      answer: {
        text: "Active protocols include TLS 1.3, QUIC, and DNS.",
        grounded: true,
        citations: [],
        is_remote: false,
        backend_id: "local-rule-engine",
        disclosure: "",
      },
    } as any);

    render(<AssistantTestWrapper />);

    const suggestionBtn = screen.getByRole("button", { name: /What protocols am I using/i });
    fireEvent.click(suggestionBtn);

    expect(await screen.findByRole("heading", { name: /What protocols am I using/i })).toBeInTheDocument();
    expect(screen.getByText("Active protocols include TLS 1.3, QUIC, and DNS.")).toBeInTheDocument();
  });

  it("clears conversation thread when Clear Chat button is clicked", async () => {
    vi.spyOn(ipcModule, "query").mockResolvedValue({
      kind: "assistantAnswer",
      answer: {
        text: "Sample response",
        grounded: false,
        citations: [],
        is_remote: false,
        backend_id: "local",
        disclosure: "",
      },
    } as any);

    render(<AssistantTestWrapper />);

    const suggestionBtn = screen.getByRole("button", { name: /Summarize my traffic/i });
    fireEvent.click(suggestionBtn);

    expect(await screen.findByRole("heading", { name: /Summarize my traffic/i })).toBeInTheDocument();

    const clearBtn = screen.getByRole("button", { name: /Clear Chat/i });
    fireEvent.click(clearBtn);

    expect(screen.queryByRole("heading", { name: /Summarize my traffic/i })).not.toBeInTheDocument();
    expect(screen.getByText("Ask NetPulse Assistant")).toBeInTheDocument();
  });
});
