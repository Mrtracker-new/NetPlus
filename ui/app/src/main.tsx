import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// The single source of visual language (docs/01 §9) — styles every np-* class.
import "@netpulse/design-system/styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root element");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
