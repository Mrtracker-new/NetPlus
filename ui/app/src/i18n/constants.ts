export const DEFAULT_LANGUAGE = "en" as const;
export const FALLBACK_LANGUAGE = DEFAULT_LANGUAGE;
export const LANGUAGE_STORAGE_KEY = "netpulse.language" as const;
export const SUPPORTED_LANGUAGES = ["en", "es"] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];
