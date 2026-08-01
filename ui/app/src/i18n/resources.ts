import enCommon from "./locales/en/common.json";
import enDashboard from "./locales/en/dashboard.json";
import enApps from "./locales/en/apps.json";
import enJourney from "./locales/en/journey.json";
import enTimeline from "./locales/en/timeline.json";
import enMonitoring from "./locales/en/monitoring.json";
import enDiagnostics from "./locales/en/diagnostics.json";
import enSandbox from "./locales/en/sandbox.json";
import enFleet from "./locales/en/fleet.json";
import enCompare from "./locales/en/compare.json";
import enSecurity from "./locales/en/security.json";
import enAssistant from "./locales/en/assistant.json";
import enLearn from "./locales/en/learn.json";
import enExplorer from "./locales/en/explorer.json";
import enRecordings from "./locales/en/recordings.json";
import enReplay from "./locales/en/replay.json";
import enExport from "./locales/en/export.json";
import enPlugins from "./locales/en/plugins.json";
import enSettings from "./locales/en/settings.json";
import enErrors from "./locales/en/errors.json";

import esCommon from "./locales/es/common.json";
import esDashboard from "./locales/es/dashboard.json";
import esApps from "./locales/es/apps.json";
import esJourney from "./locales/es/journey.json";
import esTimeline from "./locales/es/timeline.json";
import esMonitoring from "./locales/es/monitoring.json";
import esDiagnostics from "./locales/es/diagnostics.json";
import esSandbox from "./locales/es/sandbox.json";
import esFleet from "./locales/es/fleet.json";
import esCompare from "./locales/es/compare.json";
import esSecurity from "./locales/es/security.json";
import esAssistant from "./locales/es/assistant.json";
import esLearn from "./locales/es/learn.json";
import esExplorer from "./locales/es/explorer.json";
import esRecordings from "./locales/es/recordings.json";
import esReplay from "./locales/es/replay.json";
import esExport from "./locales/es/export.json";
import esPlugins from "./locales/es/plugins.json";
import esSettings from "./locales/es/settings.json";
import esErrors from "./locales/es/errors.json";

export const resources = {
  en: {
    common: enCommon,
    dashboard: enDashboard,
    apps: enApps,
    journey: enJourney,
    timeline: enTimeline,
    monitoring: enMonitoring,
    diagnostics: enDiagnostics,
    sandbox: enSandbox,
    fleet: enFleet,
    compare: enCompare,
    security: enSecurity,
    assistant: enAssistant,
    learn: enLearn,
    explorer: enExplorer,
    recordings: enRecordings,
    replay: enReplay,
    export: enExport,
    plugins: enPlugins,
    settings: enSettings,
    errors: enErrors,
  },
  es: {
    common: esCommon,
    dashboard: esDashboard,
    apps: esApps,
    journey: esJourney,
    timeline: esTimeline,
    monitoring: esMonitoring,
    diagnostics: esDiagnostics,
    sandbox: esSandbox,
    fleet: esFleet,
    compare: esCompare,
    security: esSecurity,
    assistant: esAssistant,
    learn: esLearn,
    explorer: esExplorer,
    recordings: esRecordings,
    replay: esReplay,
    export: esExport,
    plugins: esPlugins,
    settings: esSettings,
    errors: esErrors,
  },
} as const;
