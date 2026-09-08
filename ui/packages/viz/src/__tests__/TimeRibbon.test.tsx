import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TimeRibbon, calcRibbonPos } from "../TimeRibbon";
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

  it("renders .np-ribbon__scrubber vertical line guide across lanes positioned at selected event", () => {
    const events: RibbonEvent[] = [
      { at: 1000, label: "First event", severity: "neutral" },
      { at: 2000, label: "Second event", severity: "notable" },
      { at: 3000, label: "Third event", severity: "finding" },
    ];

    const { container } = render(
      <TimeRibbon
        events={events}
        selectedIndex={1}
        timeDomain={{ min: 0, max: 4000 }}
      />
    );

    const scrubber = container.querySelector(".np-ribbon__scrubber");
    expect(scrubber).toBeInTheDocument();
    expect(scrubber).toHaveAttribute("aria-hidden", "true");
    // at=2000 in domain 0..4000 is 50%
    expect(scrubber).toHaveStyle({ left: "50%" });
  });

  it("renders .np-ribbon__scrubber positioned at highlightTimestamp when scrubbing time directly", () => {
    const events: RibbonEvent[] = [
      { at: 0, label: "Start event", severity: "neutral" },
      { at: 10000, label: "End event", severity: "finding" },
    ];

    const { container } = render(
      <TimeRibbon
        events={events}
        highlightTimestamp={7500}
        timeDomain={{ min: 0, max: 10000 }}
      />
    );

    const scrubber = container.querySelector(".np-ribbon__scrubber");
    expect(scrubber).toBeInTheDocument();
    // at=7500 in domain 0..10000 is 75%
    expect(scrubber).toHaveStyle({ left: "75%" });
  });

  it("renders .np-ribbon__scrubber at first event position when no event is selected", () => {
    const events: RibbonEvent[] = [
      { at: 5000, label: "Default event", severity: "neutral" },
    ];

    const { container } = render(
      <TimeRibbon
        events={events}
        timeDomain={{ min: 0, max: 10000 }}
      />
    );

    const scrubber = container.querySelector(".np-ribbon__scrubber");
    expect(scrubber).toBeInTheDocument();
    // at=5000 in domain 0..10000 is 50%
    expect(scrubber).toHaveStyle({ left: "50%" });
  });

  it("does not render .np-ribbon__scrubber when events array is empty", () => {
    const { container } = render(<TimeRibbon events={[]} />);
    expect(container.querySelector(".np-ribbon__scrubber")).not.toBeInTheDocument();
  });

  it("updates .np-ribbon__scrubber position dynamically as selectedIndex navigates between events", () => {
    const events: RibbonEvent[] = [
      { at: 2000, label: "First", severity: "neutral" },
      { at: 5000, label: "Second", severity: "notable" },
      { at: 8000, label: "Third", severity: "finding" },
    ];

    const { container, rerender } = render(
      <TimeRibbon
        events={events}
        selectedIndex={0}
        timeDomain={{ min: 0, max: 10000 }}
      />
    );

    const scrubber = container.querySelector(".np-ribbon__scrubber");
    expect(scrubber).toBeInTheDocument();
    expect(scrubber).toHaveStyle({ left: "20%" });

    // Navigate to next event (index 1)
    rerender(
      <TimeRibbon
        events={events}
        selectedIndex={1}
        timeDomain={{ min: 0, max: 10000 }}
      />
    );
    expect(scrubber).toHaveStyle({ left: "50%" });

    // Navigate to third event (index 2)
    rerender(
      <TimeRibbon
        events={events}
        selectedIndex={2}
        timeDomain={{ min: 0, max: 10000 }}
      />
    );
    expect(scrubber).toHaveStyle({ left: "80%" });
  });

  it("handles duplicate event objects maintaining distinct global indices without indexOf collisions", () => {
    const sharedEvent: RibbonEvent = {
      at: 1000,
      label: "Repeated Alert",
      severity: "finding",
    };
    const onSelect = vi.fn();

    render(<TimeRibbon events={[sharedEvent, sharedEvent]} onSelectEvent={onSelect} />);

    const mark1 = screen.getByRole("button", { name: "Event 1: Repeated Alert (finding)" });
    const mark2 = screen.getByRole("button", { name: "Event 2: Repeated Alert (finding)" });

    expect(mark1).toBeInTheDocument();
    expect(mark2).toBeInTheDocument();

    // Clicking second identical event mark passes globalIndex 1, not 0
    fireEvent.click(mark2);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(sharedEvent, 1);
  });

  it("safely computes min and max via loop reduction without timeDomain or array spread", () => {
    const events: RibbonEvent[] = [
      { at: 5000, label: "Mid", severity: "neutral" },
      { at: 1000, label: "Min", severity: "neutral" },
      { at: 9000, label: "Max", severity: "neutral" },
    ];

    render(<TimeRibbon events={events} />);

    const minMark = screen.getByRole("button", { name: "Event 2: Min (neutral)" });
    const midMark = screen.getByRole("button", { name: "Event 1: Mid (neutral)" });
    const maxMark = screen.getByRole("button", { name: "Event 3: Max (neutral)" });

    // Span is 9000 - 1000 = 8000
    // Min at 1000 -> ratio 0 -> clamped to 2%
    // Mid at 5000 -> ratio (5000-1000)/8000 = 0.5 -> 50%
    // Max at 9000 -> ratio 1.0 -> clamped to 98%
    expect(minMark).toHaveStyle({ left: "2%" });
    expect(midMark).toHaveStyle({ left: "50%" });
    expect(maxMark).toHaveStyle({ left: "98%" });
  });
});

describe("calcRibbonPos", () => {
  it("returns '50%' when span <= 0 (min equals max or inverted)", () => {
    expect(calcRibbonPos(5000, 5000, 5000)).toBe("50%");
    expect(calcRibbonPos(5000, 10000, 5000)).toBe("50%");
  });

  it("clamps lower bound to 2.00% for values at or below min", () => {
    expect(calcRibbonPos(0, 1000, 5000)).toBe("2.00%");
    expect(calcRibbonPos(1000, 1000, 5000)).toBe("2.00%");
  });

  it("clamps upper bound to 98.00% for values at or above max", () => {
    expect(calcRibbonPos(5000, 1000, 5000)).toBe("98.00%");
    expect(calcRibbonPos(6000, 1000, 5000)).toBe("98.00%");
  });

  it("calculates accurate proportional percentage between 2% and 98%", () => {
    expect(calcRibbonPos(3000, 1000, 5000)).toBe("50.00%");
    expect(calcRibbonPos(2000, 1000, 5000)).toBe("25.00%");
    expect(calcRibbonPos(4000, 1000, 5000)).toBe("75.00%");
  });
});

