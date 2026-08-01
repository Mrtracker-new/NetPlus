import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { EvidenceChip, EvidenceChips, formatEvidenceLabel } from "../EvidenceChip";
import type { EvidenceRef } from "@netpulse/contract";

afterEach(() => {
  cleanup();
});

describe("formatEvidenceLabel", () => {
  it("formats flow, session, and packet evidence correctly", () => {
    expect(formatEvidenceLabel({ kind: "flow", id: 12 })).toBe("flow #12");
    expect(formatEvidenceLabel({ kind: "session", id: 34 })).toBe("session #34");
    expect(formatEvidenceLabel({ kind: "packet", id: 56 })).toBe("packet #56");
  });

  it("handles unknown/future evidence types gracefully", () => {
    expect(formatEvidenceLabel({ kind: "unknown_type" as any, id: 99 })).toBe("unknown_type #99");
    expect(formatEvidenceLabel(null as any)).toBe("unknown evidence");
    expect(formatEvidenceLabel({} as any)).toBe("unknown evidence");
  });
});

describe("EvidenceChip", () => {
  it("renders interactive button by default and handles click", () => {
    const onNavigate = vi.fn();
    const ref: EvidenceRef = { kind: "flow", id: 42 };

    render(<EvidenceChip evidence={ref} onNavigate={onNavigate} />);

    const chip = screen.getByRole("button", { name: /flow #42/i });
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveAttribute("tabIndex", "0");

    fireEvent.click(chip);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(ref);
  });

  it("supports keyboard navigation via Enter and Space keys", () => {
    const onNavigate = vi.fn();
    const ref: EvidenceRef = { kind: "session", id: 7 };

    render(<EvidenceChip evidence={ref} onNavigate={onNavigate} />);
    const chip = screen.getByRole("button", { name: /session #7/i });

    fireEvent.keyDown(chip, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(ref);

    fireEvent.keyDown(chip, { key: " " });
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it("renders non-interactive static chip when interactive=false", () => {
    const onNavigate = vi.fn();
    const ref: EvidenceRef = { kind: "packet", id: 100 };

    render(<EvidenceChip evidence={ref} interactive={false} onNavigate={onNavigate} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    const staticSpan = screen.getByText("packet #100");
    expect(staticSpan.tagName).toBe("SPAN");
    expect(staticSpan).toHaveClass("np-evidence--static");

    fireEvent.click(staticSpan);
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("EvidenceChips", () => {
  it("returns null when evidence list is empty or null", () => {
    const { container } = render(<EvidenceChips evidence={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders multiple chips and invokes onNavigate independently", () => {
    const onNavigate = vi.fn();
    const list: EvidenceRef[] = [
      { kind: "flow", id: 1 },
      { kind: "session", id: 2 },
      { kind: "packet", id: 3 },
    ];

    render(<EvidenceChips evidence={list} onNavigate={onNavigate} />);

    const flowChip = screen.getByRole("button", { name: /flow #1/i });
    const sessionChip = screen.getByRole("button", { name: /session #2/i });
    const packetChip = screen.getByRole("button", { name: /packet #3/i });

    fireEvent.click(flowChip);
    expect(onNavigate).toHaveBeenLastCalledWith(list[0]);

    fireEvent.click(sessionChip);
    expect(onNavigate).toHaveBeenLastCalledWith(list[1]);

    fireEvent.click(packetChip);
    expect(onNavigate).toHaveBeenLastCalledWith(list[2]);
  });
});
