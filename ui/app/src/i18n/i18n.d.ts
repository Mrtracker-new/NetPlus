import "i18next";
import { resources } from "./resources";
import { DEFAULT_NAMESPACE } from "./namespaces";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: typeof DEFAULT_NAMESPACE;
    resources: typeof resources["en"];
  }
}
