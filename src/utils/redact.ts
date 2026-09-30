/**
 * Redaction helpers.
 *
 * Every string that leaves KayShield - log line, notification, diagnostic,
 * error message, tooltip - goes through this module first. The rule is
 * deliberately blunt: it is better to redact something harmless than to leak
 * one token.
 *
 * Pure module: safe to unit test and to call from anywhere.
 */

import { SECRET_PATTERNS } from '../security/SecretPatterns';

export const REDACTED = '[redacted]';

/** Assignment forms found in .env, JSON, YAML and TOML files. */
const ASSIGNMENT =
  /([A-Za-z_$][\w.$-]*)(\s*["']?\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[^\s,;)\]}]+)/g;

/** URLs of the form scheme://user:password@host */
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)([^\s/@]+)(@)/gi;

/**
 * Replaces every assignment value and every known secret format with
 * {@link REDACTED}. Keys are preserved so logs stay useful.
 */
export function redactText(text: string): string {
  let output = text.replace(ASSIGNMENT, (_match, key: string, separator: string) => {
    return `${key}${separator}${REDACTED}`;
  });

  output = output.replace(URL_CREDENTIALS, (_match, prefix: string, _secret, suffix: string) => {
    return `${prefix}${REDACTED}${suffix}`;
  });

  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(new RegExp(pattern.regex.source, 'g'), REDACTED);
  }

  return output;
}

/**
 * Redacts an arbitrary value before it is logged. Objects are serialized then
 * redacted; strings are redacted directly; errors keep their name and message
 * shape but never their payload.
 */
export function redactUnknown(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === 'string') {
    return redactText(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Error) {
    return `${value.name}: ${redactText(value.message)}`;
  }
  try {
    return redactText(JSON.stringify(value) ?? String(value));
  } catch {
    return '[unserializable]';
  }
}

/**
 * Never reveals content. Used when a message needs to refer to a value at all,
 * for example "3 secrets found". The result contains no fragment of the input.
 */
export function describeSecret(): string {
  return REDACTED;
}
