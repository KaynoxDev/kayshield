/**
 * The tests that matter most: nothing sensitive may appear in anything the
 * extension emits - logs, diagnostics, notifications, tooltips.
 */

import { describe, expect, it } from 'vitest';
import { redactText, redactUnknown, REDACTED } from '../../src/utils/redact';
import { SecurityScanner } from '../../src/security/SecurityScanner';
import { DEFAULT_RULES } from '../../src/security/SecretDetector';

/**
 * Token-shaped fixtures are assembled at runtime instead of being written as
 * literals.
 *
 * They are fake, but a literal that *looks* like a credential trips every
 * scanner the repository passes through - GitHub push protection included, and
 * EnvShield's own detector too. Splitting them keeps the tests exact (the code
 * under test still receives a complete, correctly shaped token) while leaving
 * no token-shaped string in the source of a security extension.
 */
const fake = (...parts: string[]): string => parts.join('');

const GITHUB_TOKEN = fake('ghp', '_', 'abcdefghijklmnopqrstuvwxyz0123456789');
const OPENAI_KEY = fake('sk-proj', '-', 'abcdefghijklmnopqrstuvwxyz012345');
const JWT = fake('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', '.', 'eyJzdWIiOiIxIn0', '.', 'abcdefgh');
const AWS_KEY_ID = fake('AKIA', 'IOSFODNN7EXAMPLE');
const SLACK_TOKEN = fake('xox', 'b-1234567890-abcdefghijklmno');

const SECRETS = [GITHUB_TOKEN, OPENAI_KEY, JWT, AWS_KEY_ID, SLACK_TOKEN, 'super-secret-password'];

describe('redaction', () => {
  it('removes the value of every assignment form', () => {
    const samples = [
      'DISCORD_TOKEN=eyJhbGciOiJIUzI1NiIs',
      '"discordToken": "eyJhbGciOiJIUzI1NiIs"',
      'discord_token: eyJhbGciOiJIUzI1NiIs',
      'token = "eyJhbGciOiJIUzI1NiIs"',
    ];
    for (const sample of samples) {
      const redacted = redactText(sample);
      expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiIs');
      expect(redacted).toContain(REDACTED);
    }
  });

  it('keeps the key so logs stay useful', () => {
    expect(redactText('DISCORD_TOKEN=abcdef')).toContain('DISCORD_TOKEN');
  });

  it('removes credentials embedded in a URL', () => {
    const redacted = redactText('postgresql://user:hunter2@localhost/mydb');
    expect(redacted).not.toContain('hunter2');
  });

  it('removes known secret formats even outside an assignment', () => {
    for (const secret of SECRETS.slice(0, 5)) {
      const redacted = redactText(`something happened near ${secret} while parsing`);
      expect(redacted).not.toContain(secret);
    }
  });

  it('redacts errors without losing the error type', () => {
    const error = new Error('failed to parse API_KEY=sk-live-abcdefghijklmnop');
    const redacted = redactUnknown(error);
    expect(redacted).toContain('Error');
    expect(redacted).not.toContain('sk-live-abcdefghijklmnop');
  });

  it('redacts objects', () => {
    const redacted = redactUnknown({ DATABASE_URL: 'postgresql://u:p@host/db' });
    expect(redacted).not.toContain('postgresql://u:p@host/db');
  });

  it('handles values that cannot be serialized', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(redactUnknown(circular)).toBe('[unserializable]');
  });

  it('passes through harmless primitives', () => {
    expect(redactUnknown(42)).toBe('42');
    expect(redactUnknown(true)).toBe('true');
    expect(redactUnknown(null)).toBe('null');
  });
});

describe('scanner findings', () => {
  const scanner = new SecurityScanner();

  it('reports the position and the name, never the value', () => {
    const source = ['{', '  "port": 3000,', `  "discordToken": "${GITHUB_TOKEN}"`, '}'].join('\n');

    const findings = scanner.scan(source, 'structured', DEFAULT_RULES);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.key).toBe('discordToken');
    expect(findings[0]?.line).toBe(2);

    const serialized = JSON.stringify(findings);
    expect(serialized).not.toContain(GITHUB_TOKEN);
  });

  it('scans .env files through the parser', () => {
    const findings = scanner.scan('PORT=3000\nAPI_KEY=sk-live-abcdefghij\n', 'env', DEFAULT_RULES);
    expect(findings.map((finding) => finding.key)).toEqual(['API_KEY']);
    expect(JSON.stringify(findings)).not.toContain('sk-live');
  });

  it('finds secrets in YAML and TOML style assignments', () => {
    const yaml = 'services:\n  db:\n    password: hunter2-not-a-real-password\n';
    const toml = 'api_key = "sk-live-abcdefghijklmnop"\n';
    expect(scanner.scan(yaml, 'structured', DEFAULT_RULES)).toHaveLength(1);
    expect(scanner.scan(toml, 'structured', DEFAULT_RULES)).toHaveLength(1);
  });

  it('ignores structure openers and comments', () => {
    const source = '{\n  "config": {\n    "port": 3000\n  }\n}\n';
    expect(scanner.scan(source, 'structured', DEFAULT_RULES)).toHaveLength(0);
  });

  it('honours ignoredVariables', () => {
    const findings = scanner.scan('API_KEY=sk-live-abcdefghij\n', 'env', {
      ...DEFAULT_RULES,
      ignoredVariables: ['API_KEY'],
    });
    expect(findings).toHaveLength(0);
  });

  it('summaries never quote the value', () => {
    const findings = scanner.scan('PASSWORD=hunter2-not-a-real-password\n', 'env', DEFAULT_RULES);
    for (const finding of findings) {
      expect(finding.summary).not.toContain('hunter2');
    }
  });
});
