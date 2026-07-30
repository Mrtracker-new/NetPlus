import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./i18n";
import { runI18nTests } from "./i18n/__tests__/i18n.test";
// The single source of visual language (docs/01 §9) — styles every np-* class.
import "@netpulse/design-system/styles.css";

runI18nTests();

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root element");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
