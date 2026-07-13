export function renderTemplate(template: string, payload: Record<string, unknown>): string {
  if (template.includes("{__raw__}")) {
    return template.replace("{__raw__}", JSON.stringify(payload, null, 2).slice(0, 4000));
  }

  return template.replace(/\{([^}]+)\}/g, (match, path: string) => {
    const value = resolvePath(payload, path.trim());
    if (value === undefined) return match;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value).slice(0, 2000);
  });
}

export function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
