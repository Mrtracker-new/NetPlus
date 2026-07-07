// Theme toggle — light (default) ↔ the original deep-observatory dark. Mirrors
// the DisclosureContext persistence pattern (localStorage, first-run default).
// The choice is written to <html data-theme>, which the design tokens key off
// (tokens.css: [data-theme="dark"]). Light is the default per the overhaul.

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
const STORAGE_KEY = "netpulse.theme";

function initial(): Theme {
  if (typeof localStorage === "undefined") return "light";
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "dark" ? "dark" : "light";
}

/** Apply and persist the theme; returns [theme, toggle]. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    const root = document.documentElement;
    // Light is the token default (:root), so only the dark attribute is set.
    if (theme === "dark") root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  return [theme, toggle];
}
