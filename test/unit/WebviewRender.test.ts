/**
 * Renders the real webview script in a DOM and inspects the result.
 *
 * A silent JavaScript error in `media/editor.js` would leave the secure editor
 * blank, and no VS Code integration test would notice. These tests load the
 * actual file, feed it a realistic masked payload and assert both that it
 * renders and that nothing sensitive reaches the DOM.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/env/EnvParser';
import { buildVariables, toMaskedVariables } from '../../src/env/EnvVariable';
import { MaskingEngine } from '../../src/security/MaskingEngine';
import { createAnalyzer, DEFAULT_RULES } from '../../src/security/SecretDetector';
import type { MaskedVariable } from '../../src/types';

const SCRIPT = readFileSync(join(__dirname, '..', '..', 'media', 'editor.js'), 'utf8');

const SOURCE = [
  'DISCORD_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhIjoxfQ.c2lnbmF0dXJl',
  'DATABASE_URL=postgresql://user:password@localhost/mydb',
  'API_KEY=sk-proj-xxxxxxxxxxxxxxxx',
  'PASSWORD=super-secret-password',
  'PORT=3000',
  'NODE_ENV=development',
  'EMPTY=',
  '',
].join('\n');

const STRINGS: Record<string, string> = {
  title: 'Environment Variables',
  searchPlaceholder: 'Search variables...',
  searchNote: 'Search matches variable names only, never values.',
  variable: 'Variable',
  value: 'Value',
  actions: 'Actions',
  reveal: 'Reveal {0}',
  hide: 'Hide {0}',
  copy: 'Copy value of {0}',
  edit: 'Edit value of {0}',
  remove: 'Delete {0}',
  addVariable: 'Add variable',
  hideAll: 'Hide all',
  revealAll: 'Reveal all',
  openAsText: 'Open as text',
  streamOn: 'STREAM MODE ON',
  streamOff: 'Streamer Mode',
  streamHint: 'Every sensitive value stays masked while Streamer Mode is on.',
  templateHint: 'Template file.',
  empty: '(empty)',
  noResults: 'No variable matches your search.',
  noVariables: 'This file contains no variable yet.',
  protectedSummary: '{0} of {1} variables protected',
  keyLabel: 'Name',
  valueLabel: 'Value',
  save: 'Save',
  cancel: 'Cancel',
  readOnly: 'This file is read-only.',
  severitySecret: 'Secret',
  severitySensitive: 'Sensitive',
  severitySuspicious: 'Suspicious',
  severityNormal: 'Normal',
};

function payload(streamerMode = false): {
  variables: MaskedVariable[];
  state: Record<string, unknown>;
  strings: Record<string, string>;
} {
  const variables = buildVariables(parseEnv(SOURCE), {
    analyzer: createAnalyzer(),
    rules: DEFAULT_RULES,
    revealed: new Set<string>(),
    forceMask: streamerMode,
  });
  const masked = toMaskedVariables(variables, new MaskingEngine());
  return {
    variables: masked,
    state: {
      fileName: '.env',
      streamerMode,
      revealTimeout: 5000,
      isTemplate: false,
      secretCount: masked.filter((entry) => entry.secret).length,
      totalCount: masked.length,
      readOnly: false,
    },
    strings: STRINGS,
  };
}

interface Harness {
  readonly dom: JSDOM;
  readonly document: Document;
  readonly posted: Record<string, unknown>[];
  send(message: Record<string, unknown>): void;
  click(selector: string): void;
}

function mount(initial = payload()): Harness {
  // Same escaping as `EnvEditorProvider.buildHtml`: an unescaped `<` inside a
  // <script> block would let a hostile variable name close the tag.
  const serialized = JSON.stringify({ type: 'init', ...initial }).replace(/</g, '\\u003c');

  const dom = new JSDOM(
    `<!DOCTYPE html><html><body>
      <div id="app" aria-busy="true"></div>
      <script id="envshield-payload" type="application/json">${serialized}</script>
    </body></html>`,
    { runScripts: 'outside-only' },
  );

  const posted: Record<string, unknown>[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dom.window as any).acquireVsCodeApi = () => ({
    postMessage: (message: Record<string, unknown>) => posted.push(message),
    getState: () => undefined,
    setState: () => undefined,
  });

  dom.window.eval(SCRIPT);

  return {
    dom,
    document: dom.window.document,
    posted,
    send(message) {
      dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: message }));
    },
    click(selector) {
      const element = dom.window.document.querySelector(selector);
      if (!element) {
        throw new Error(`no element for ${selector}`);
      }
      (element as HTMLElement).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    },
  };
}

let harness: Harness | undefined;

afterEach(() => {
  harness?.dom.window.close();
  harness = undefined;
});

describe('webview rendering', () => {
  it('renders one row per variable without throwing', () => {
    harness = mount();
    const rows = harness.document.querySelectorAll('tbody tr[data-id]');
    expect(rows).toHaveLength(7);
    expect(harness.document.getElementById('app')?.getAttribute('aria-busy')).toBe('false');
  });

  it('signals readiness to the host', () => {
    harness = mount();
    expect(harness.posted).toContainEqual({ type: 'ready' });
  });

  it('shows masked values for secrets and clear values for the rest', () => {
    harness = mount();
    const cells = [...harness.document.querySelectorAll('tbody tr[data-id]')].map((row) => ({
      key: row.querySelector('td.key')?.textContent?.trim(),
      value: row.querySelector('td.value')?.textContent?.trim(),
      masked: row.querySelector('td.value')?.classList.contains('masked'),
    }));

    const byKey = Object.fromEntries(cells.map((cell) => [cell.key, cell]));
    expect(byKey.PORT?.value).toBe('3000');
    expect(byKey.NODE_ENV?.value).toBe('development');
    expect(byKey.PASSWORD?.masked).toBe(true);
    expect(byKey.API_KEY?.masked).toBe(true);
    expect(byKey.EMPTY?.value).toBe('(empty)');
  });

  it('leaks no secret into the rendered DOM', () => {
    harness = mount();
    const html = harness.document.body.innerHTML;
    for (const secret of [
      'super-secret-password',
      'sk-proj-xxxxxxxxxxxxxxxx',
      'user:password@localhost',
      'eyJhbGciOiJIUzI1NiIs',
    ]) {
      expect(html).not.toContain(secret);
    }
  });

  it('gives every action button an accessible label', () => {
    harness = mount();
    for (const button of harness.document.querySelectorAll('.icon-button')) {
      expect(button.getAttribute('aria-label')).toBeTruthy();
    }
    const reveal = harness.document.querySelector('[data-action="reveal"]');
    expect(reveal?.getAttribute('aria-label')).toMatch(/^Reveal /);
    expect(reveal?.getAttribute('aria-pressed')).toBe('false');
  });

  it('positions the search glyph with a wrapper that no glyph can match', () => {
    harness = mount();
    const wrappers = harness.document.querySelectorAll('.search-icon');
    expect(wrappers).toHaveLength(1);

    // The regression this guards: the wrapper used to carry `.icon` too, so the
    // CSS rule meant for it also matched the <svg> nested inside, offsetting the
    // glyph twice and pushing it over the placeholder text. A positioned
    // wrapper must never share a class with the glyphs it contains.
    const wrapper = wrappers[0] as Element;
    expect(wrapper.classList.contains('icon')).toBe(false);
    expect(wrapper.querySelectorAll('svg.icon')).toHaveLength(1);

    const style = readFileSync(join(__dirname, '..', '..', 'media', 'editor.css'), 'utf8');
    expect(style).not.toMatch(/\.search\s+\.icon\s*\{/);
    expect(style).toMatch(/\.search-icon\s*\{[^}]*position:\s*absolute/);
    // Without an explicit vertical rule the glyph falls back to its static
    // position inside a flex container, which engines resolve differently.
    expect(style).toMatch(/\.search-icon\s*\{[^}]*translateY/);
  });

  it('emits no stray class name on a glyph', () => {
    harness = mount();
    for (const glyph of harness.document.querySelectorAll('svg.icon')) {
      expect(glyph.getAttribute('class')).toBe(glyph.getAttribute('class')?.trim());
    }
  });

  it('asks the host to reveal, and never reveals on its own', () => {
    harness = mount();
    harness.click('[data-action="reveal"]');
    const request = harness.posted.find((message) => message.type === 'reveal');
    expect(request).toBeDefined();

    // Nothing changed on screen: the host has not answered yet.
    expect(harness.document.body.innerHTML).not.toContain('super-secret-password');
  });

  it('shows a value only after the host sends it, and hides it again on mask', () => {
    harness = mount();
    const id = harness.document
      .querySelector('[data-action="reveal"]')
      ?.getAttribute('data-id') as string;

    harness.send({ type: 'value', id, value: 'revealed-plaintext', timeout: 5000 });
    expect(harness.document.body.innerHTML).toContain('revealed-plaintext');

    harness.send({ type: 'mask', id });
    expect(harness.document.body.innerHTML).not.toContain('revealed-plaintext');
  });

  it('drops every revealed value on a global mask', () => {
    harness = mount();
    const ids = [...harness.document.querySelectorAll('[data-action="reveal"]')].map((button) =>
      button.getAttribute('data-id'),
    );
    for (const id of ids) {
      harness.send({ type: 'value', id, value: `plain-${id}`, timeout: 0 });
    }
    expect(harness.document.body.innerHTML).toContain('plain-');

    harness.send({ type: 'mask' });
    expect(harness.document.body.innerHTML).not.toContain('plain-');
  });

  it('filters on names only', () => {
    harness = mount();
    const search = harness.document.getElementById('search') as HTMLInputElement;
    search.value = 'PASS';
    search.dispatchEvent(new harness.dom.window.Event('input', { bubbles: true }));

    const keys = [...harness.document.querySelectorAll('tbody tr[data-id] td.key')].map((cell) =>
      cell.textContent?.trim(),
    );
    expect(keys).toEqual(['PASSWORD']);
  });

  it('shows an empty state when the search matches nothing', () => {
    harness = mount();
    const search = harness.document.getElementById('search') as HTMLInputElement;
    search.value = 'zzzz-no-such-variable';
    search.dispatchEvent(new harness.dom.window.Event('input', { bubbles: true }));
    expect(harness.document.body.textContent).toContain('No variable matches your search.');
  });

  it('disables reveal and shows the badge in Streamer Mode', () => {
    harness = mount(payload(true));
    expect(harness.document.querySelector('.badge.stream-on')?.textContent).toContain(
      'STREAM MODE ON',
    );
    for (const button of harness.document.querySelectorAll('[data-action="reveal"]')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(
      (harness.document.querySelector('[data-action="revealAll"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('treats Escape as a panic gesture', () => {
    harness = mount();
    harness.document.dispatchEvent(
      new harness.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(harness.posted).toContainEqual({ type: 'hideAll' });
  });

  it('re-renders from a host update', () => {
    harness = mount();
    const next = payload();
    harness.send({
      type: 'update',
      variables: next.variables.slice(0, 2),
      state: { ...next.state, totalCount: 2 },
    });
    expect(harness.document.querySelectorAll('tbody tr[data-id]')).toHaveLength(2);
  });

  it('renders a toast without interpreting its content as markup', () => {
    harness = mount();
    harness.send({ type: 'toast', text: '<img src=x onerror=alert(1)>', tone: 'warning' });
    const toast = harness.document.querySelector('.toast');
    expect(toast?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(toast?.querySelector('img')).toBeNull();
  });

  it('escapes a hostile variable name', () => {
    const hostile = payload();
    const first = hostile.variables[0] as MaskedVariable;
    hostile.variables[0] = { ...first, key: '<script>alert(1)</script>' };
    harness = mount(hostile);
    expect(harness.document.querySelector('script[data-injected]')).toBeNull();
    expect(harness.document.body.textContent).toContain('<script>alert(1)</script>');
  });
});
