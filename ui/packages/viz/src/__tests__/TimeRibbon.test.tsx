import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TimeRibbon, calcRibbonPos, calcCollisionOffset } from "../TimeRibbon";
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

  it("applies collision offsets and renders count badge for marks with identical timestamps in the same lane", () => {
    const events: RibbonEvent[] = [
      { at: 5000, label: "Finding A", severity: "finding" },
      { at: 5000, label: "Finding B", severity: "finding" },
    ];

    const { container } = render(
      <TimeRibbon events={events} timeDomain={{ min: 0, max: 10000 }} />
    );

    const mark1 = screen.getByRole("button", { name: "Event 1: Finding A (finding)" });
    const mark2 = screen.getByRole("button", { name: "Event 2: Finding B (finding)" });

    // Both marks have collision metadata
    expect(mark1).toHaveAttribute("data-collision-count", "2");
    expect(mark1).toHaveAttribute("data-collision-index", "0");
    expect(mark1).toHaveAttribute("data-collision-offset", "-3px");
    expect(mark1).toHaveStyle({ left: "calc(50% - 3px)" });

    expect(mark2).toHaveAttribute("data-collision-count", "2");
    expect(mark2).toHaveAttribute("data-collision-index", "1");
    expect(mark2).toHaveAttribute("data-collision-offset", "3px");
    expect(mark2).toHaveStyle({ left: "calc(50% + 3px)" });

    // Descriptive tooltip title indicating position in cluster
    expect(mark1).toHaveAttribute("title", "Finding A (1 of 2 at this timestamp)");
    expect(mark2).toHaveAttribute("title", "Finding B (2 of 2 at this timestamp)");

    // Count badge rendered on cluster
    const badge = container.querySelector(".np-ribbon__count-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("2");
    expect(badge).toHaveAttribute("data-count", "2");
  });

  it("fans out three marks symmetrically and renders count badge showing 3", () => {
    const events: RibbonEvent[] = [
      { at: 5000, label: "Alert 1", severity: "notable" },
      { at: 5000, label: "Alert 2", severity: "notable" },
      { at: 5000, label: "Alert 3", severity: "notable" },
    ];

    const { container } = render(
      <TimeRibbon events={events} timeDomain={{ min: 0, max: 10000 }} />
    );

    const mark1 = screen.getByRole("button", { name: "Event 1: Alert 1 (notable)" });
    const mark2 = screen.getByRole("button", { name: "Event 2: Alert 2 (notable)" });
    const mark3 = screen.getByRole("button", { name: "Event 3: Alert 3 (notable)" });

    // Step 6px: count 3 offsets are -6px, 0px, +6px
    expect(mark1).toHaveStyle({ left: "calc(50% - 6px)" });
    expect(mark2).toHaveStyle({ left: "50%" });
    expect(mark3).toHaveStyle({ left: "calc(50% + 6px)" });

    const badge = container.querySelector(".np-ribbon__count-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("3");
  });

  it("supports custom collisionOffsetPx and showCountBadge options", () => {
    const events: RibbonEvent[] = [
      { at: 5000, label: "Event X", severity: "neutral" },
      { at: 5000, label: "Event Y", severity: "neutral" },
    ];

    // Custom offset distance 10px -> -5px and +5px
    const { container, rerender } = render(
      <TimeRibbon
        events={events}
        timeDomain={{ min: 0, max: 10000 }}
        collisionOffsetPx={10}
        showCountBadge={false}
      />
    );

    const mark1 = screen.getByRole("button", { name: "Event 1: Event X (neutral)" });
    const mark2 = screen.getByRole("button", { name: "Event 2: Event Y (neutral)" });

    expect(mark1).toHaveStyle({ left: "calc(50% - 5px)" });
    expect(mark2).toHaveStyle({ left: "calc(50% + 5px)" });

    // showCountBadge=false suppresses the badge element
    expect(container.querySelector(".np-ribbon__count-badge")).not.toBeInTheDocument();

    // Disable offset with collisionOffsetPx=0
    rerender(
      <TimeRibbon
        events={events}
        timeDomain={{ min: 0, max: 10000 }}
        collisionOffsetPx={0}
        showCountBadge={true}
      />
    );

    expect(mark1).toHaveStyle({ left: "50%" });
    expect(mark2).toHaveStyle({ left: "50%" });
    expect(container.querySelector(".np-ribbon__count-badge")).toBeInTheDocument();
  });

  it("does not offset marks with identical timestamps when placed in different severity lanes", () => {
    const events: RibbonEvent[] = [
      { at: 5000, label: "Finding mark", severity: "finding" },
      { at: 5000, label: "Notable mark", severity: "notable" },
      { at: 5000, label: "Neutral mark", severity: "neutral" },
    ];

    const { container } = render(
      <TimeRibbon events={events} timeDomain={{ min: 0, max: 10000 }} />
    );

    const findingMark = screen.getByRole("button", { name: /Finding mark/i });
    const notableMark = screen.getByRole("button", { name: /Notable mark/i });
    const neutralMark = screen.getByRole("button", { name: /Neutral mark/i });

    // All marks align vertically across lanes at 50% without collision offsets
    expect(findingMark).toHaveStyle({ left: "50%" });
    expect(notableMark).toHaveStyle({ left: "50%" });
    expect(neutralMark).toHaveStyle({ left: "50%" });

    // No collision badges because each lane has only 1 mark
    expect(container.querySelector(".np-ribbon__count-badge")).not.toBeInTheDocument();
    expect(findingMark).not.toHaveAttribute("data-collision-count");
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

describe("calcCollisionOffset", () => {
  it("returns 0 when collisionCount <= 1", () => {
    expect(calcCollisionOffset(0, 0)).toBe(0);
    expect(calcCollisionOffset(0, 1)).toBe(0);
  });

  it("computes symmetric offsets for even counts", () => {
    // Count 2, step 6: -3, +3
    expect(calcCollisionOffset(0, 2, 6)).toBe(-3);
    expect(calcCollisionOffset(1, 2, 6)).toBe(3);

    // Custom step 10: -5, +5
    expect(calcCollisionOffset(0, 2, 10)).toBe(-5);
    expect(calcCollisionOffset(1, 2, 10)).toBe(5);
  });

  it("computes symmetric offsets for odd counts", () => {
    // Count 3, step 6: -6, 0, +6
    expect(calcCollisionOffset(0, 3, 6)).toBe(-6);
    expect(calcCollisionOffset(1, 3, 6)).toBe(0);
    expect(calcCollisionOffset(2, 3, 6)).toBe(6);
  });

  it("computes accurate offsets for larger clusters (e.g. 4)", () => {
    // Count 4, step 8: -12, -4, +4, +12
    expect(calcCollisionOffset(0, 4, 8)).toBe(-12);
    expect(calcCollisionOffset(1, 4, 8)).toBe(-4);
    expect(calcCollisionOffset(2, 4, 8)).toBe(4);
    expect(calcCollisionOffset(3, 4, 8)).toBe(12);
  });
});

