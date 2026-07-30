import { resources } from "../resources";

function compareStructure(
  path: string,
  baseline: Record<string, unknown>,
  target: Record<string, unknown>
): string[] {
  const errors: string[] = [];

  for (const key of Object.keys(baseline)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (!(key in target)) {
      errors.push(`Missing key: "${currentPath}"`);
      continue;
    }

    const baselineVal = baseline[key];
    const targetVal = target[key];

    const baselineType = typeof baselineVal;
    const targetType = typeof targetVal;

    if (baselineType !== targetType) {
      errors.push(`Type mismatch at "${currentPath}": expected ${baselineType}, found ${targetType}`);
      continue;
    }

    if (baselineVal !== null && typeof baselineVal === "object") {
      errors.push(
        ...compareStructure(
          currentPath,
          baselineVal as Record<string, unknown>,
          targetVal as Record<string, unknown>
        )
      );
    }
  }

  for (const key of Object.keys(target)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (!(key in baseline)) {
      errors.push(`Extra key in target: "${currentPath}"`);
    }
  }

  return errors;
}

export function validateLocaleCompleteness(): void {
  const errors = compareStructure("", resources.en, resources.es);
  if (errors.length > 0) {
    throw new Error(`Locale completeness validation failed:\n${errors.join("\n")}`);
  }
}
