import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NarrativeFilterBar } from "../screens/Dashboard/NarrativeFilterBar";

afterEach(() => {
  cleanup();
});

describe("NarrativeFilterBar Component", () => {
  it("renders all category tabs with correct accessible names and icons", () => {
    render(
      <NarrativeFilterBar
        category="all"
        search=""
        onSelectCategory={vi.fn()}
        onSearchChange={vi.fn()}
        count={5}
        totalCount={10}
      />
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(7);

    const expectedLabels = [
      "All Activity",
      "Security Findings",
      "Performance & Latency",
      "DNS Queries",
      "TLS & HTTPS",
      "Applications",
      "Network Flows",
    ];

    expectedLabels.forEach((label) => {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    });
  });

  it("applies roving tabindex and aria-selected correctly to active and inactive tabs", () => {
    render(
      <NarrativeFilterBar
        category="dns"
        search=""
        onSelectCategory={vi.fn()}
        onSearchChange={vi.fn()}
        count={3}
        totalCount={12}
      />
    );

    const dnsTab = screen.getByRole("tab", { name: "DNS Queries" });
    const allTab = screen.getByRole("tab", { name: "All Activity" });
    const tlsTab = screen.getByRole("tab", { name: "TLS & HTTPS" });

    expect(dnsTab).toHaveAttribute("aria-selected", "true");
    expect(dnsTab).toHaveAttribute("tabindex", "0");
    expect(dnsTab).toHaveClass("np-filter-tab-pill--active");

    expect(allTab).toHaveAttribute("aria-selected", "false");
    expect(allTab).toHaveAttribute("tabindex", "-1");
    expect(allTab).not.toHaveClass("np-filter-tab-pill--active");

    expect(tlsTab).toHaveAttribute("aria-selected", "false");
    expect(tlsTab).toHaveAttribute("tabindex", "-1");
  });

  it("renders active indicator pip for selected category", () => {
    render(
      <NarrativeFilterBar
        category="findings"
        search=""
        onSelectCategory={vi.fn()}
        onSearchChange={vi.fn()}
        count={2}
        totalCount={8}
      />
    );

    const findingsTab = screen.getByRole("tab", { name: "Security Findings" });
    expect(findingsTab.querySelector(".np-filter-tab-indicator")).toBeInTheDocument();

    const allTab = screen.getByRole("tab", { name: "All Activity" });
    expect(allTab.querySelector(".np-filter-tab-indicator")).not.toBeInTheDocument();
  });

  it("calls onSelectCategory when a category tab is clicked", () => {
    const onSelectCategory = vi.fn();
    render(
      <NarrativeFilterBar
        category="all"
        search=""
        onSelectCategory={onSelectCategory}
        onSearchChange={vi.fn()}
        count={10}
        totalCount={10}
      />
    );

    const networkTab = screen.getByRole("tab", { name: "Network Flows" });
    fireEvent.click(networkTab);

    expect(onSelectCategory).toHaveBeenCalledTimes(1);
    expect(onSelectCategory).toHaveBeenCalledWith("network");
  });

  it("supports keyboard navigation with ArrowRight, ArrowLeft, Home, and End", () => {
    const onSelectCategory = vi.fn();
    render(
      <NarrativeFilterBar
        category="all"
        search=""
        onSelectCategory={onSelectCategory}
        onSearchChange={vi.fn()}
        count={5}
        totalCount={10}
      />
    );

    const allTab = screen.getByRole("tab", { name: "All Activity" });

    // ArrowRight from index 0 ("all") -> index 1 ("findings")
    fireEvent.keyDown(allTab, { key: "ArrowRight" });
    expect(onSelectCategory).toHaveBeenCalledWith("findings");

    // ArrowLeft from index 0 ("all") -> index 6 ("network" - circular wrap)
    fireEvent.keyDown(allTab, { key: "ArrowLeft" });
    expect(onSelectCategory).toHaveBeenCalledWith("network");

    // End -> last category ("network")
    fireEvent.keyDown(allTab, { key: "End" });
    expect(onSelectCategory).toHaveBeenCalledWith("network");

    // Home -> first category ("all")
    fireEvent.keyDown(allTab, { key: "Home" });
    expect(onSelectCategory).toHaveBeenCalledWith("all");
  });

  it("handles search input changes and clear button", () => {
    const onSearchChange = vi.fn();
    const { rerender } = render(
      <NarrativeFilterBar
        category="all"
        search=""
        onSelectCategory={vi.fn()}
        onSearchChange={onSearchChange}
        count={10}
        totalCount={10}
      />
    );

    const input = screen.getByLabelText("Search narrative feed");
    expect(screen.queryByLabelText("Clear search")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "chrome" } });
    expect(onSearchChange).toHaveBeenCalledWith("chrome");

    // Rerender with search value populated
    rerender(
      <NarrativeFilterBar
        category="all"
        search="chrome"
        onSelectCategory={vi.fn()}
        onSearchChange={onSearchChange}
        count={2}
        totalCount={10}
      />
    );

    const clearBtn = screen.getByLabelText("Clear search");
    expect(clearBtn).toBeInTheDocument();

    fireEvent.click(clearBtn);
    expect(onSearchChange).toHaveBeenCalledWith("");
  });

  it("clears search on Escape key press in search input", () => {
    const onSearchChange = vi.fn();
    render(
      <NarrativeFilterBar
        category="all"
        search="spotify"
        onSelectCategory={vi.fn()}
        onSearchChange={onSearchChange}
        count={1}
        totalCount={10}
      />
    );

    const input = screen.getByLabelText("Search narrative feed");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onSearchChange).toHaveBeenCalledWith("");
  });

  it("renders counter badge with formatted counts and live polite aria announcement", () => {
    render(
      <NarrativeFilterBar
        category="all"
        search=""
        onSelectCategory={vi.fn()}
        onSearchChange={vi.fn()}
        count={4}
        totalCount={15}
      />
    );

    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("/ 15 cards")).toBeInTheDocument();
  });
});
