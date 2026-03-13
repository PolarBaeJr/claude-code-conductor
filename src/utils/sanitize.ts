/**
 * Shared prompt sanitization utilities.
 *
 * Consolidates sanitization logic previously duplicated across:
 * - worker-prompt.ts (sanitizePromptSection)
 * - flow-tracer.ts (sanitizeConfigValue)
 * - flow-worker-prompt.ts (sanitizeConfigValue)
 *
 * All user-provided content injected into prompts MUST be sanitized
 * to prevent prompt injection attacks (role marker injection,
 * markdown header manipulation, etc.).
 */

/**
 * Sanitize user-provided prompt content to prevent injection and keep size bounded.
 * Strips role markers that could confuse the model and truncates to a reasonable limit.
 *
 * Use for large prompt sections like feature descriptions, QA context, threat models,
 * project rules, and project guidance.
 *
 * @param content - The raw content to sanitize
 * @param maxLength - Maximum allowed length (default 10000)
 * @returns Sanitized and truncated string
 */
export function sanitizePromptSection(content: string, maxLength: number = 10_000): string {
  if (!content) return "";
  let sanitized = content;
  // Strip role markers that could confuse the model
  sanitized = sanitized.replace(/\b(Human|Assistant|System):/gi, "[removed]:");
  // Truncate
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength) + "\n[truncated]";
  }
  return sanitized;
}

/**
 * Sanitize a config string value before injecting into a prompt.
 * Strips role markers AND markdown headers, and truncates to a short limit.
 *
 * Use for shorter config values like layer names, actor types, entry points,
 * edge cases, flow names, security invariants, and convention array items.
 *
 * @param value - The raw config value to sanitize
 * @param maxLength - Maximum allowed length (default 200)
 * @returns Sanitized and truncated string
 */
export function sanitizeConfigValue(value: string, maxLength: number = 200): string {
  if (!value) return "";
  let sanitized = value;
  // Strip role markers that could confuse the model
  sanitized = sanitized.replace(/Human:|Assistant:|System:/gi, "[removed]");
  // Strip markdown headers to prevent prompt structure manipulation
  sanitized = sanitized.replace(/^#{1,6}\s/gm, "");
  // Truncate
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength) + "\u2026";
  }
  return sanitized;
}
