import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { HealthStrip } from "../screens/Dashboard/HealthStrip";
import type { HealthViewModel } from "../screens/Dashboard/viewModels";

describe("HealthStrip Accessibility & Keyboard Navigation", () => {
  afterEach(() => {
    cleanup();
  });

  const mockHealth: HealthViewModel = {
    subsystems: [
      {
        name: "Capture Pipeline",
        status: "healthy",
        detail: "Active streaming",
      },
      {
        name: "Storage Engine",
        status: "warning",
        detail: "Active (68409 drops recorded, stage: None)",
      },
      {
        name: "Network Driver",
        status: "degraded",
        detail: "Interface buffer saturation detected",
      },
      {
        name: "Diagnostic Engine",
        status: "healthy",
        detail: "6/7 Hops Grounded",
      },
    ],
    drops: 42,
  };

  it("renders all subsystem items and drops item with keyboard focusability (tabIndex=0)", () => {
    render(<HealthStrip health={mockHealth} />);

    // Region landmark
    const region = screen.getByRole("region", { name: /System Health Telemetry/i });
    expect(region).toBeInTheDocument();

    // Query all items
    const captureItem = screen.getByText("Capture:").closest(".np-health-strip__item");
    const storageItem = screen.getByText("Storage:").closest(".np-health-strip__item");
    const driverItem = screen.getByText("Driver:").closest(".np-health-strip__item");
    const diagItem = screen.getByText("Diagnostics:").closest(".np-health-strip__item");
    const dropsItem = screen.getByText("Drops:").closest(".np-health-strip__item");

    expect(captureItem).toBeInTheDocument();
    expect(storageItem).toBeInTheDocument();
    expect(driverItem).toBeInTheDocument();
    expect(diagItem).toBeInTheDocument();
    expect(dropsItem).toBeInTheDocument();

    // Verify all items are focusable by keyboard users
    expect(captureItem).toHaveAttribute("tabIndex", "0");
    expect(storageItem).toHaveAttribute("tabIndex", "0");
    expect(driverItem).toHaveAttribute("tabIndex", "0");
    expect(diagItem).toHaveAttribute("tabIndex", "0");
    expect(dropsItem).toHaveAttribute("tabIndex", "0");
  });

  it("exposes accessible descriptions via aria-description on all items", () => {
    render(<HealthStrip health={mockHealth} />);

    const captureItem = screen.getByText("Capture:").closest(".np-health-strip__item")!;
    const storageItem = screen.getByText("Storage:").closest(".np-health-strip__item")!;
    const driverItem = screen.getByText("Driver:").closest(".np-health-strip__item")!;
    const diagItem = screen.getByText("Diagnostics:").closest(".np-health-strip__item")!;
    const dropsItem = screen.getByText("Drops:").closest(".np-health-strip__item")!;

    // Verify aria-description
    expect(captureItem).toHaveAttribute("aria-description", "Capture Pipeline: Active streaming");
    expect(storageItem).toHaveAttribute("aria-description", "Storage Engine: Active (68409 drops recorded, stage: None)");
    expect(driverItem).toHaveAttribute("aria-description", "Network Driver: Interface buffer saturation detected");
    expect(diagItem).toHaveAttribute("aria-description", "Diagnostic Engine: 6/7 Hops Grounded");
    expect(dropsItem).toHaveAttribute("aria-description", "Kernel / Buffer Packet Drop Count");

    // Verify accessible description in testing-library
    expect(captureItem).toHaveAccessibleDescription("Capture Pipeline: Active streaming");
    expect(storageItem).toHaveAccessibleDescription("Storage Engine: Active (68409 drops recorded, stage: None)");
    expect(driverItem).toHaveAccessibleDescription("Network Driver: Interface buffer saturation detected");
    expect(dropsItem).toHaveAccessibleDescription("Kernel / Buffer Packet Drop Count");
  });

  it("mounts accessible tooltip and links aria-describedby on keyboard focus", () => {
    render(<HealthStrip health={mockHealth} />);

    const storageItem = screen.getByText("Storage:").closest(".np-health-strip__item") as HTMLElement;

    // Initially when idle, tooltip is not mounted so queries won't find duplicate text
    expect(storageItem).not.toHaveAttribute("aria-describedby");
    expect(document.getElementById("health-tooltip-storage-engine")).toBeNull();

    // Focus on storage item via keyboard
    act(() => {
      storageItem.focus();
    });

    expect(storageItem).toHaveAttribute("aria-describedby", "health-tooltip-storage-engine");
    const tooltip = document.getElementById("health-tooltip-storage-engine");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveAttribute("role", "tooltip");
    expect(tooltip).toHaveTextContent("Storage Engine: Active (68409 drops recorded, stage: None)");
  });

  it("supports sequential keyboard tabbing across all subsystem items", () => {
    render(<HealthStrip health={mockHealth} />);

    const captureItem = screen.getByText("Capture:").closest(".np-health-strip__item") as HTMLElement;
    const storageItem = screen.getByText("Storage:").closest(".np-health-strip__item") as HTMLElement;
    const driverItem = screen.getByText("Driver:").closest(".np-health-strip__item") as HTMLElement;
    const diagItem = screen.getByText("Diagnostics:").closest(".np-health-strip__item") as HTMLElement;
    const dropsItem = screen.getByText("Drops:").closest(".np-health-strip__item") as HTMLElement;

    // Focus sequence
    act(() => {
      captureItem.focus();
    });
    expect(document.activeElement).toBe(captureItem);

    act(() => {
      storageItem.focus();
    });
    expect(document.activeElement).toBe(storageItem);

    act(() => {
      driverItem.focus();
    });
    expect(document.activeElement).toBe(driverItem);

    act(() => {
      diagItem.focus();
    });
    expect(document.activeElement).toBe(diagItem);

    act(() => {
      dropsItem.focus();
    });
    expect(document.activeElement).toBe(dropsItem);
  });

  it("dismisses tooltip on Escape keydown and restores on re-focus", () => {
    render(<HealthStrip health={mockHealth} />);

    const driverItem = screen.getByText("Driver:").closest(".np-health-strip__item") as HTMLElement;

    // Focus driver item
    act(() => {
      driverItem.focus();
    });

    expect(document.getElementById("health-tooltip-network-driver")).toBeInTheDocument();
    expect(driverItem).toHaveAttribute("aria-describedby", "health-tooltip-network-driver");

    // Press Escape to dismiss tooltip while retaining focus
    fireEvent.keyDown(driverItem, { key: "Escape" });
    expect(document.getElementById("health-tooltip-network-driver")).toBeNull();
    expect(driverItem).not.toHaveAttribute("aria-describedby");
    expect(document.activeElement).toBe(driverItem);

    // Blur and re-focus restores tooltip
    act(() => {
      fireEvent.blur(driverItem);
    });
    act(() => {
      fireEvent.focus(driverItem);
    });
    expect(document.getElementById("health-tooltip-network-driver")).toBeInTheDocument();
  });

  it("mounts tooltip on mouse enter and unmounts on mouse leave", () => {
    render(<HealthStrip health={mockHealth} />);

    const dropsItem = screen.getByText("Drops:").closest(".np-health-strip__item")!;

    // Hover
    fireEvent.mouseEnter(dropsItem);
    expect(document.getElementById("health-tooltip-drops")).toBeInTheDocument();
    expect(dropsItem).toHaveAttribute("aria-describedby", "health-tooltip-drops");

    // Leave
    fireEvent.mouseLeave(dropsItem);
    expect(document.getElementById("health-tooltip-drops")).toBeNull();
    expect(dropsItem).not.toHaveAttribute("aria-describedby");
  });

  it("renders status glyphs and styles for warning and degraded subsystems", () => {
    render(<HealthStrip health={mockHealth} />);

    const warningGlyph = screen.getAllByText("⚠");
    expect(warningGlyph.length).toBe(2); // Storage (warning) and Driver (degraded)

    const dots = document.querySelectorAll(".np-health-dot");
    expect(dots[0]).toHaveClass("np-health-dot--active");
    expect(dots[1]).toHaveClass("np-health-dot--warning");
    expect(dots[2]).toHaveClass("np-health-dot--degraded");
  });
});
