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
});
