import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, afterEach } from "vitest";
import { App } from "../App";
import i18n from "../i18n";

afterEach(async () => {
  cleanup();
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("Navigation Labeling Alignment", () => {
  it("aligns rail button label and header indicator to 'Applications' in English", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });

    render(<App />);

    // Find the navigation rail button for Applications
    const appsNavButton = screen.getByRole("button", { name: "Applications" });
    expect(appsNavButton).toBeInTheDocument();
    expect(appsNavButton).toHaveAttribute("title", "Applications");
    expect(appsNavButton).toHaveAttribute("data-label", "Applications");

    // Click navigation rail button to switch to applications screen
    fireEvent.click(appsNavButton);

    // Verify the header screen indicator aligns with 'Applications'
    const screenIndicator = screen.getByRole("status", { name: "Applications" });
    expect(screenIndicator).toBeInTheDocument();
    expect(screenIndicator).toHaveTextContent("Applications");
  });

  it("aligns rail button label and header indicator to 'Aplicaciones' in Spanish", async () => {
    await act(async () => {
      await i18n.changeLanguage("es");
    });

    render(<App />);

    // Find the navigation rail button for Aplicaciones in Spanish
    const appsNavButton = screen.getByRole("button", { name: "Aplicaciones" });
    expect(appsNavButton).toBeInTheDocument();
    expect(appsNavButton).toHaveAttribute("title", "Aplicaciones");
    expect(appsNavButton).toHaveAttribute("data-label", "Aplicaciones");

    // Click navigation rail button to switch to applications screen
    fireEvent.click(appsNavButton);

    // Verify the header screen indicator aligns with 'Aplicaciones'
    const screenIndicator = screen.getByRole("status", { name: "Aplicaciones" });
    expect(screenIndicator).toBeInTheDocument();
    expect(screenIndicator).toHaveTextContent("Aplicaciones");
  });
});
