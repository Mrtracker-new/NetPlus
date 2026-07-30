import enAssistant from "./locales/en/assistant.json";
import enCommon from "./locales/en/common.json";
import enDashboard from "./locales/en/dashboard.json";
import enErrors from "./locales/en/errors.json";
import enExport from "./locales/en/export.json";
import enPlugins from "./locales/en/plugins.json";
import enSecurity from "./locales/en/security.json";
import enSettings from "./locales/en/settings.json";

import esAssistant from "./locales/es/assistant.json";
import esCommon from "./locales/es/common.json";
import esDashboard from "./locales/es/dashboard.json";
import esErrors from "./locales/es/errors.json";
import esExport from "./locales/es/export.json";
import esPlugins from "./locales/es/plugins.json";
import esSecurity from "./locales/es/security.json";
import esSettings from "./locales/es/settings.json";

export const resources = {
  en: {
    common: enCommon,
    dashboard: enDashboard,
    assistant: enAssistant,
    plugins: enPlugins,
    security: enSecurity,
    export: enExport,
    settings: enSettings,
    errors: enErrors,
  },
  es: {
    common: esCommon,
    dashboard: esDashboard,
    assistant: esAssistant,
    plugins: esPlugins,
    security: esSecurity,
    export: esExport,
    settings: esSettings,
    errors: esErrors,
  },
} as const;
