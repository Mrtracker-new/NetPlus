import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, afterEach } from "vitest";
import { Chart, type ChartSeries } from "../components/Chart";

afterEach(() => {
  cleanup();
});

const mockThroughputSeries: ChartSeries[] = [
  {
    name: "Ingress",
    data: [100, 250, 400, 800, 1200, 500, 300, 600, 900, 1500, 800, 400],
    color: "var(--np-accent, #2fe0d6)",
  },
  {
    name: "Egress",
    data: [50, 120, 200, 350, 600, 250, 150, 280, 420, 700, 350, 180],
    color: "var(--np-accent-2, #7c83f7)",
  },
];

const mockTimestamps = [
  "5m ago",
  "4m ago",
  "3m ago",
  "2m ago",
  "1m ago",
  "Now",
];

describe("Chart Spline Hover Tooltip", () => {
  it("renders empty state placeholder when series data is insufficient", () => {
    render(
      <Chart
        variant="throughput"
        series={[{ name: "Empty", data: [10] }]}
      />
    );
    expect(screen.getByText("Waiting for live telemetry samples…")).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("does not render tooltip initially when idle", () => {
    render(
      <Chart
        variant="throughput"
        series={mockThroughputSeries}
        timestamps={mockTimestamps}
      />
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chart-tooltip")).not.toBeInTheDocument();
  });

  it("renders floating tooltip displaying rate values and time offset on mouse hover", () => {
    render(
      <Chart
        variant="throughput"
        series={mockThroughputSeries}
        timestamps={mockTimestamps}
      />
    );

    // Hover over column index 0 ("5m ago")
    const col0 = screen.getByTestId("chart-hover-col-0");
    fireEvent.mouseEnter(col0);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveAttribute("data-testid", "chart-tooltip");

    // Displays Time Offset
    expect(tooltip).toHaveTextContent("Time Offset");
    expect(tooltip).toHaveTextContent("5m ago");

    // Displays series names and rate values
    expect(tooltip).toHaveTextContent("Ingress");
    expect(tooltip).toHaveTextContent("100 KB/s");
    expect(tooltip).toHaveTextContent("Egress");
    expect(tooltip).toHaveTextContent("50 KB/s");
  });

  it("updates tooltip content dynamically when hovering across different time intervals", () => {
    render(
      <Chart
        variant="throughput"
        series={mockThroughputSeries}
        timestamps={mockTimestamps}
      />
    );

    // Hover over rightmost column (index 11, which maps to "Now")
    const col11 = screen.getByTestId("chart-hover-col-11");
    fireEvent.mouseEnter(col11);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent("Now");
    expect(tooltip).toHaveTextContent("Ingress");
    expect(tooltip).toHaveTextContent("400 KB/s");
    expect(tooltip).toHaveTextContent("Egress");
    expect(tooltip).toHaveTextContent("180 KB/s");

    // Move to column 4 (data: Ingress=1200 -> 1.2 MB/s, Egress=600 -> 600 KB/s)
    const col4 = screen.getByTestId("chart-hover-col-4");
    fireEvent.mouseMove(col4);
    expect(tooltip).toHaveTextContent("1.2 MB/s");
    expect(tooltip).toHaveTextContent("600 KB/s");
  });

  it("removes tooltip when mouse leaves the chart", () => {
    const { container } = render(
      <Chart
        variant="throughput"
        series={mockThroughputSeries}
        timestamps={mockTimestamps}
      />
    );

    const col0 = screen.getByTestId("chart-hover-col-0");
    fireEvent.mouseEnter(col0);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    // Mouse leave chart
    const chartWrapper = container.firstElementChild as HTMLElement;
    fireEvent.mouseLeave(chartWrapper);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("supports custom formatValue function in floating tooltip", () => {
    const customFormat = (val: number) => `${val} packets/sec`;
    render(
      <Chart
        variant="throughput"
        series={mockThroughputSeries}
        timestamps={mockTimestamps}
        formatValue={customFormat}
      />
    );

    const col2 = screen.getByTestId("chart-hover-col-2");
    fireEvent.mouseEnter(col2);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent("400 packets/sec");
    expect(tooltip).toHaveTextContent("200 packets/sec");
  });

  it("renders tooltip for single-series gains variant with peak badge intact", () => {
    const gainsSeries: ChartSeries[] = [
      {
        name: "Total Throughput Volume",
        data: [150, 370, 600, 1150, 1800, 750, 450, 880, 1320, 2200, 1150, 580],
        color: "var(--np-accent, #2fe0d6)",
      },
    ];

    render(
      <Chart
        variant="gains"
        series={gainsSeries}
        timestamps={mockTimestamps}
        peakBadgeText="2.2 MB/s"
      />
    );

    // Peak badge is rendered
    expect(screen.getByText("2.2 MB/s")).toBeInTheDocument();

    // Hover over column 4
    const col4 = screen.getByTestId("chart-hover-col-4");
    fireEvent.mouseEnter(col4);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent("Total Throughput Volume");
    expect(tooltip).toHaveTextContent("1.8 MB/s");
    expect(tooltip).toHaveTextContent("Time Offset");
  });

  it("positions tooltip below point when near top (<75px) and above point when lower", () => {
    // Top-peaked series where point 0 is at maximum value (very close to y = 10)
    const topPeakedSeries: ChartSeries[] = [
      {
        name: "Ingress",
        data: [10000, 10000, 100, 100],
      },
    ];

    const { rerender } = render(
      <Chart
        variant="throughput"
        series={topPeakedSeries}
        timestamps={["Start", "Middle", "NearEnd", "End"]}
      />
    );

    // Column 0 has maximum rate -> anchorY is near 10px -> transformY must be 10px (below)
    const col0 = screen.getByTestId("chart-hover-col-0");
    fireEvent.mouseEnter(col0);
    const tooltipTop = screen.getByRole("tooltip");
    expect(tooltipTop.style.transform).toContain("10px");
    expect(tooltipTop.style.transform).not.toContain("calc(-100%");

    // Column 3 has low rate (100) -> anchorY is near 150px -> transformY must be calc(-100% - 10px) (above)
    const col3 = screen.getByTestId("chart-hover-col-3");
    fireEvent.mouseEnter(col3);
    const tooltipBottom = screen.getByRole("tooltip");
    expect(tooltipBottom.style.transform).toContain("calc(-100% - 10px)");
  });

  it("handles NaN and non-numeric rate values safely without crashing", () => {
    const nanSeries: ChartSeries[] = [
      {
        name: "Ingress",
        data: [NaN as unknown as number, 500, 300],
      },
    ];

    render(
      <Chart
        variant="throughput"
        series={nanSeries}
        timestamps={["Start", "Middle", "End"]}
      />
    );

    const col0 = screen.getByTestId("chart-hover-col-0");
    fireEvent.mouseEnter(col0);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent("0 B/s");
    expect(tooltip.textContent).not.toContain("NaN");
  });
});

