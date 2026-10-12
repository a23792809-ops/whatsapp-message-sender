export const TEMPLATE_VARIABLE_REGEX = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Extracts unique template variable names from a template body string.
 * Example: "Hello {{customer_name}}, booking {{booking_no}}" -> ["customer_name", "booking_no"]
 */
export function extractTemplateVariables(body: string): string[] {
  if (!body) return [];
  const re = new RegExp(TEMPLATE_VARIABLE_REGEX);
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    found.add(match[1]);
  }
  return Array.from(found);
}

/**
 * Substitutes variables into a template body.
 * If a variable is missing or empty, it leaves the placeholder in place and records it in `missing`.
 */
export function renderTemplate(
  body: string,
  values: Record<string, string | undefined | null>,
): { rendered: string; missing: string[] } {
  if (!body) return { rendered: '', missing: [] };

  const missing = new Set<string>();
  const rendered = body.replace(new RegExp(TEMPLATE_VARIABLE_REGEX), (_, key: string) => {
    const val = values[key];
    if (val === undefined || val === null || String(val).trim() === '') {
      missing.add(key);
      return `{{${key}}}`;
    }
    return String(val);
  });

  return { rendered, missing: Array.from(missing) };
}

/**
 * Checks whether any unresolved `{{placeholder}}` remains in the rendered message.
 */
export function hasUnresolvedVariables(text: string): boolean {
  if (!text) return false;
  return new RegExp(TEMPLATE_VARIABLE_REGEX).test(text);
}
