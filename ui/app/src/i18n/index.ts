import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { FALLBACK_LANGUAGE } from "./constants";
import { resolveInitialLanguage, syncDocumentLanguage } from "./language";
import { DEFAULT_NAMESPACE } from "./namespaces";
import { resources } from "./resources";

const initialLanguage = resolveInitialLanguage();

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: FALLBACK_LANGUAGE,
  defaultNS: DEFAULT_NAMESPACE,
  fallbackNS: DEFAULT_NAMESPACE,
  interpolation: {
    escapeValue: false, // React handles escaping
  },
  react: {
    useSuspense: false,
  },
});

syncDocumentLanguage(i18n);

i18n.on("languageChanged", () => {
  syncDocumentLanguage(i18n);
});

export default i18n;
export * from "./constants";
export * from "./language";
export * from "./namespaces";
export { resources } from "./resources";
