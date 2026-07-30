import type { i18n } from "i18next";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  type Language,
} from "./constants";

export function isSupportedLanguage(lang: unknown): lang is Language {
  return typeof lang === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(lang);
}

export function normalizeLanguage(locale: string): Language {
  const code = (locale || "").split("-")[0]?.toLowerCase() || "";
  if (isSupportedLanguage(code)) {
    return code;
  }
  return DEFAULT_LANGUAGE;
}

export function resolveInitialLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved && isSupportedLanguage(saved)) {
      return saved;
    }
  } catch {
    // Ignore storage access errors
  }

  if (typeof navigator !== "undefined" && navigator.language) {
    return normalizeLanguage(navigator.language);
  }

  return DEFAULT_LANGUAGE;
}

export function syncDocumentLanguage(instance: i18n): void {
  if (typeof document === "undefined") return;
  const lang = instance.language || DEFAULT_LANGUAGE;
  document.documentElement.lang = lang;
  document.documentElement.dir = instance.dir(lang);
}

export async function changeLanguage(instance: i18n, lang: Language): Promise<void> {
  if (!isSupportedLanguage(lang)) {
    throw new Error(`Unsupported language: ${String(lang)}`);
  }
  await instance.changeLanguage(lang);
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // Ignore storage write errors
  }
  syncDocumentLanguage(instance);
}
