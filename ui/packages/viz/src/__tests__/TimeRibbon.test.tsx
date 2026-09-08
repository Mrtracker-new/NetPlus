import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TimeRibbon } from "../TimeRibbon";
import type { RibbonEvent } from "../types";

describe("TimeRibbon Component", () => {
  it("highlights mark when highlightPacketId matches an event's evidence array", () => {
    const events: RibbonEvent[] = [
      {
        at: 1000,
        label: "Normal event",
        severity: "neutral",
        evidence: [{ kind: "flow", id: 101 }],
      },
      {
        at: 2000,
        label: "Target packet event",
        severity: "finding",
        evidence: [{ kind: "packet", id: 999 }],
      },
    ];

    render(
      <TimeRibbon
        events={events}
        highlightPacketId={999}
      />
    );

    const normalMark = screen.getByRole("button", { name: /Normal event/i });
    const targetMark = screen.getByRole("button", { name: /Target packet event/i });

    expect(normalMark).not.toHaveAttribute("data-highlighted");
    expect(targetMark).toHaveAttribute("data-highlighted", "true");
    expect(targetMark).toHaveAttribute("aria-pressed", "true");
    expect(targetMark.className).toContain("np-ribbon__mark--highlighted");
  });

  it("uses authoritative timeDomain to position marks instead of fallback local min/max", () => {
    const events: RibbonEvent[] = [
      {
        at: 5000,
        label: "Mid event",
        severity: "finding",
      },
    ];

    // Authoritative timeDomain from parent filter (0 to 10000)
    render(
      <TimeRibbon
        events={events}
        timeDomain={{ min: 0, max: 10000 }}
      />
    );

    const mark = screen.getByRole("button", { name: /Mid event/i });
    // at=5000 in domain 0..10000 should be positioned at 50%
    expect(mark.style.left).toBe("50%");
  });

  it("applies roving tabindex: sets tabIndex=0 on index 0 and tabIndex=-1 on remaining marks when no mark is selected", () => {
    const events: RibbonEvent[] = [
      { at: 1000, label: "First event", severity: "neutral" },
      { at: 2000, label: "Second event", severity: "notable" },
      { at: 3000, label: "Third event", severity: "finding" },
    ];

    render(<TimeRibbon events={events} />);

    const mark0 = screen.getByRole("button", { name: /First event/i });
    const mark1 = screen.getByRole("button", { name: /Second event/i });
    const mark2 = screen.getByRole("button", { name: /Third event/i });

    expect(mark0).toHaveAttribute("tabindex", "0");
    expect(mark1).toHaveAttribute("tabindex", "-1");
    expect(mark2).toHaveAttribute("tabindex", "-1");
  });

  it("applies roving tabindex: sets tabIndex=0 on highlighted mark and tabIndex=-1 on others when a mark is selected", () => {
    const events: RibbonEvent[] = [
      { at: 1000, label: "First event", severity: "neutral" },
      { at: 2000, label: "Second event", severity: "notable" },
      { at: 3000, label: "Third event", severity: "finding" },
    ];

    render(<TimeRibbon events={events} selectedIndex={1} />);

    const mark0 = screen.getByRole("button", { name: /First event/i });
    const mark1 = screen.getByRole("button", { name: /Second event/i });
    const mark2 = screen.getByRole("button", { name: /Third event/i });

    expect(mark0).toHaveAttribute("tabindex", "-1");
    expect(mark1).toHaveAttribute("tabindex", "0");
    expect(mark2).toHaveAttribute("tabindex", "-1");
  });
});

