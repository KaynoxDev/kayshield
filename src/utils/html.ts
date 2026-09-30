/** HTML helpers for webview rendering. Pure module. */

import { randomBytes } from 'node:crypto';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

/**
 * Escapes text for interpolation into HTML markup and attribute values.
 * Every dynamic string rendered into the webview must go through this.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (char) => ESCAPES[char] ?? char);
}

/** Cryptographically random nonce for the webview Content-Security-Policy. */
export function createNonce(): string {
  return randomBytes(16).toString('base64');
}
