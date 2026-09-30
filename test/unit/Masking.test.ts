import { describe, expect, it } from 'vitest';
import { MaskingEngine, normalizeMaskCharacter } from '../../src/security/MaskingEngine';
import { parseEnv } from '../../src/env/EnvParser';
import { buildVariables, countSecrets, toMaskedVariables } from '../../src/env/EnvVariable';
import { createAnalyzer, DEFAULT_RULES } from '../../src/security/SecretDetector';

const SOURCE = [
  'DISCORD_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhIjoxfQ.c2ln',
  'DATABASE_URL=postgresql://user:password@localhost/mydb',
  'API_KEY=sk-proj-xxxxxxxxxxxxxxxx',
  'PASSWORD=super-secret-password',
  'PORT=3000',
  'NODE_ENV=development',
  '',
].join('\n');

const analyzer = createAnalyzer();

function build(revealed: string[] = [], forceMask = false) {
  return buildVariables(parseEnv(SOURCE), {
    analyzer,
    rules: DEFAULT_RULES,
    revealed: new Set(revealed),
    forceMask,
  });
}

describe('MaskingEngine', () => {
  it('masks with a fixed width by default, so the length does not leak', () => {
    const engine = new MaskingEngine();
    expect(engine.mask('a')).toBe(engine.mask('a'.repeat(120)));
    expect(engine.mask('short')).toMatch(/^•+$/);
  });

  it('can preserve length when the user asks for it', () => {
    const engine = new MaskingEngine({ preserveLength: true });
    expect(engine.mask('abcdefgh')).toHaveLength(8);
    expect(engine.mask('a'.repeat(500))).toHaveLength(48);
  });

  it('masks an empty value to an empty string', () => {
    expect(new MaskingEngine().mask('')).toBe('');
  });

  it('honours a custom mask character', () => {
    expect(new MaskingEngine({ maskCharacter: '*' }).mask('secret')).toMatch(/^\*+$/);
  });

  it('falls back to the default for an unusable mask character', () => {
    expect(normalizeMaskCharacter('')).toBe('•');
    expect(normalizeMaskCharacter(' ')).toBe('•');
    expect(normalizeMaskCharacter('ab')).toBe('a');
  });

  it('reveals only when asked', () => {
    const engine = new MaskingEngine();
    expect(engine.display('value', false)).toBe('value');
    expect(engine.display('value', true)).not.toContain('value');
  });
});

describe('variable model', () => {
  it('masks sensitive variables and leaves the rest alone', () => {
    const variables = build();
    const byKey = Object.fromEntries(variables.map((variable) => [variable.key, variable]));

    expect(byKey.DISCORD_TOKEN?.masked).toBe(true);
    expect(byKey.DATABASE_URL?.masked).toBe(true);
    expect(byKey.API_KEY?.masked).toBe(true);
    expect(byKey.PASSWORD?.masked).toBe(true);
    expect(byKey.PORT?.masked).toBe(false);
    expect(byKey.NODE_ENV?.masked).toBe(false);
    expect(countSecrets(variables)).toBe(4);
  });

  it('unmasks a revealed variable, and only that one', () => {
    const variables = build(['API_KEY@2']);
    const revealed = variables.find((variable) => variable.key === 'API_KEY');
    const other = variables.find((variable) => variable.key === 'PASSWORD');
    expect(revealed?.masked).toBe(false);
    expect(other?.masked).toBe(true);
  });

  it('forceMask overrides every reveal', () => {
    const variables = build(['API_KEY@2', 'PASSWORD@3'], true);
    expect(variables.every((variable) => !variable.secret || variable.masked)).toBe(true);
  });
});

describe('webview payload', () => {
  const engine = new MaskingEngine();

  it('never carries a secret value, even for revealed variables', () => {
    const variables = build(['API_KEY@2', 'PASSWORD@3']);
    const payload = toMaskedVariables(variables, engine);

    for (const entry of payload) {
      if (!entry.secret) {
        continue;
      }
      expect(entry.display).toMatch(/^•*$/);
    }

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('super-secret-password');
    expect(serialized).not.toContain('sk-proj-');
    expect(serialized).not.toContain('user:password@');
    expect(serialized).not.toContain('eyJhbGciOi');
  });

  it('still exposes non-sensitive values, which is the point', () => {
    const payload = toMaskedVariables(build(), engine);
    const port = payload.find((entry) => entry.key === 'PORT');
    expect(port?.display).toBe('3000');
  });

  it('reports the reveal state so the UI can render the right control', () => {
    const payload = toMaskedVariables(build(['API_KEY@2']), engine);
    const apiKey = payload.find((entry) => entry.key === 'API_KEY');
    expect(apiKey?.secret).toBe(true);
    expect(apiKey?.masked).toBe(false);
  });

  it('carries no explanation that mentions a value', () => {
    const payload = toMaskedVariables(build(), engine);
    for (const entry of payload) {
      expect(entry.summary).not.toContain('super-secret-password');
      expect(entry.summary).not.toContain('localhost/mydb');
    }
  });
});
