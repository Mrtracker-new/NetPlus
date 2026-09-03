import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Button } from "../Button";

afterEach(() => {
  cleanup();
});

describe("Button Component", () => {
  it("renders with default standard variant and size classes", () => {
    render(<Button>Click me</Button>);
    const btn = screen.getByRole("button", { name: "Click me" });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveClass("np-btn");
    expect(btn).not.toHaveClass("np-btn--primary");
    expect(btn).not.toHaveClass("np-btn--ghost");
    expect(btn).not.toHaveClass("np-btn--sm");
    expect(btn).not.toHaveClass("np-btn--xs");
  });

  it("applies variant classes correctly including ghost and secondary", () => {
    const { rerender } = render(<Button variant="primary">Primary</Button>);
    expect(screen.getByRole("button")).toHaveClass("np-btn--primary");

    rerender(<Button variant="ghost">Ghost</Button>);
    expect(screen.getByRole("button")).toHaveClass("np-btn--ghost");

    rerender(<Button variant="secondary">Secondary</Button>);
    expect(screen.getByRole("button")).toHaveClass("np-btn--secondary");

    rerender(<Button variant="danger">Danger</Button>);
    expect(screen.getByRole("button")).toHaveClass("np-btn--danger");

    rerender(<Button variant="icon">Icon</Button>);
    expect(screen.getByRole("button")).toHaveClass("np-iconbtn");
  });

  it("applies size modifiers correctly (sm, xs)", () => {
    const { rerender } = render(<Button size="sm">Small</Button>);
    expect(screen.getByRole("button")).toHaveClass("np-btn--sm");

    rerender(<Button size="xs">Extra Small</Button>);
    expect(screen.getByRole("button")).toHaveClass("np-btn--xs");
  });

  it("combines ghost variant and compact sizes seamlessly", () => {
    render(
      <Button variant="ghost" size="sm">
        Ghost Small
      </Button>
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("np-btn");
    expect(btn).toHaveClass("np-btn--ghost");
    expect(btn).toHaveClass("np-btn--sm");
  });

  it("applies active state modifier", () => {
    render(<Button active>Active</Button>);
    expect(screen.getByRole("button")).toHaveClass("np-btn--active");
  });

  it("handles icon variant sizing and active state without adding np-btn classes", () => {
    const { rerender } = render(<Button variant="icon" size="sm" active aria-label="Icon Btn" />);
    const iconBtn = screen.getByRole("button", { name: "Icon Btn" });
    expect(iconBtn).toHaveClass("np-iconbtn");
    expect(iconBtn).toHaveClass("np-iconbtn--sm");
    expect(iconBtn).toHaveClass("np-iconbtn--active");
    expect(iconBtn).not.toHaveClass("np-btn");
    expect(iconBtn).not.toHaveClass("np-btn--sm");
    expect(iconBtn).not.toHaveClass("np-btn--active");

    rerender(<Button variant="icon" size="xs" aria-label="Icon Btn" />);
    expect(iconBtn).toHaveClass("np-iconbtn--xs");
    expect(iconBtn).not.toHaveClass("np-btn--xs");
  });
});
