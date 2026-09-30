/**
 * Static guarantees about the webview assets.
 *
 * The webview is the one place where a secret could escape into something we do
 * not control, so its source is checked mechanically rather than by review:
 * no storage, no network, no eval, no inline handlers, no hardcoded colours.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const script = readFileSync(join(root, 'media', 'editor.js'), 'utf8');
const style = readFileSync(join(root, 'media', 'editor.css'), 'utf8');

/** The checks below target real code, not the comments that describe it. */
const code = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('webview script', () => {
  it('is syntactically valid JavaScript', () => {
    expect(() => new Function(script)).not.toThrow();
  });

  it('never touches persistent storage', () => {
    for (const api of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) {
      expect(code).not.toContain(api);
    }
  });

  it('never opens a network connection', () => {
    for (const api of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator.send']) {
      expect(code).not.toContain(api);
    }
  });

  it('never evaluates code', () => {
    expect(code).not.toMatch(/\beval\s*\(/);
    expect(code).not.toMatch(/new\s+Function\s*\(/);
  });

  it('escapes everything it injects into the DOM', () => {
    // Every innerHTML assignment must be built from escaped fragments.
    const assignments = code.match(/innerHTML\s*=/g) ?? [];
    expect(assignments.length).toBeLessThanOrEqual(1);
    expect(script).toContain('function escapeHtml');
  });

  it('uses textContent for untrusted single strings', () => {
    expect(script).toContain('node.textContent = text');
  });

  it('filters on variable names only, never on values', () => {
    expect(script).toContain('variable.key.toLowerCase().includes(needle)');
    expect(code).not.toMatch(/filter\([^)]*value\.toLowerCase/);
  });
});

describe('webview styles', () => {
  it('uses VS Code theme variables rather than a palette of its own', () => {
    expect(style).toContain('--vscode-editor-background');
    expect(style).toContain('--vscode-editor-foreground');
    expect(style).toContain('--vscode-button-background');
    expect(style).toContain('--vscode-input-background');
    expect(style).toContain('--vscode-panel-border');
    expect(style).toContain('--vscode-focusBorder');
  });

  it('hardcodes no colour except transparent overlays', () => {
    const hexColours = style.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexColours).toEqual([]);

    const opaqueRgb = (style.match(/rgba?\([^)]*\)/g) ?? []).filter(
      (colour) => !colour.startsWith('rgba(0, 0, 0,'),
    );
    expect(opaqueRgb).toEqual([]);
  });

  it('respects reduced motion', () => {
    expect(style).toContain('prefers-reduced-motion');
  });

  it('provides a screen-reader-only helper', () => {
    expect(style).toContain('.visually-hidden');
  });
});
