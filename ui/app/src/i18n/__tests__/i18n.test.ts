import { describe, it } from "vitest";
import {
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  normalizeLanguage,
  resolveInitialLanguage,
  syncDocumentLanguage,
} from "../index";
import i18n from "../index";
import { validateLocaleCompleteness } from "./completeness.test";

export function runI18nTests(): void {
  // 1. Recursive completeness test
  validateLocaleCompleteness();

  // 2. Language validation
  if (!isSupportedLanguage("en") || !isSupportedLanguage("es")) {
    throw new Error("isSupportedLanguage failed for valid languages");
  }
  if (isSupportedLanguage("fr") || isSupportedLanguage("invalid")) {
    throw new Error("isSupportedLanguage passed for invalid languages");
  }

  // 3. Normalization
  if (normalizeLanguage("en-US") !== "en" || normalizeLanguage("es-MX") !== "es") {
    throw new Error("normalizeLanguage failed for regional locales");
  }
  if (normalizeLanguage("fr-FR") !== DEFAULT_LANGUAGE) {
    throw new Error("normalizeLanguage failed to fallback for unsupported locale");
  }

  // 4. Initial resolution
  const resolved = resolveInitialLanguage();
  if (resolved !== "en" && resolved !== "es") {
    throw new Error(`resolveInitialLanguage returned invalid language: ${resolved}`);
  }

  // 5. Document attribute sync
  syncDocumentLanguage(i18n);
  if (typeof document !== "undefined") {
    if (document.documentElement.lang !== i18n.language) {
      throw new Error(
        `document.lang (${document.documentElement.lang}) out of sync with i18n (${i18n.language})`
      );
    }
  }

  // 6. Translation & Pluralization checks
  const enInstalled = i18n.t("installed", { ns: "plugins", count: 1 });
  if (typeof enInstalled !== "string" || !enInstalled.includes("plugin")) {
    throw new Error(`Pluralization failed for count=1: ${enInstalled}`);
  }
}

describe("i18n suite", () => {
  it("runs all i18n validations", () => {
    runI18nTests();
  });
});
