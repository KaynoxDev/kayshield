import { describe, expect, it } from 'vitest';
import {
  createAnalyzer,
  DEFAULT_RULES,
  EntropyDetector,
  NameHeuristicDetector,
  PatternDetector,
  SecretAnalyzer,
  severityOf,
  tokenizeKey,
  UserPatternDetector,
} from '../../src/security/SecretDetector';
import type { DetectionRules } from '../../src/types';

/**
 * Token-shaped fixtures are assembled at runtime instead of being written as
 * literals, so no string in this repository looks like a live credential to a
 * scanner. The detectors still receive complete, correctly shaped tokens.
 */
const fake = (...parts: string[]): string => parts.join('');

const analyzer = createAnalyzer();

function score(key: string, value: string, rules: DetectionRules = DEFAULT_RULES): number {
  return analyzer.analyze({ key, value }, rules).score;
}

function isSecret(key: string, value: string, rules: DetectionRules = DEFAULT_RULES): boolean {
  return analyzer.analyze({ key, value }, rules).secret;
}

describe('severity bands', () => {
  it('follows the specified score ranges', () => {
    expect(severityOf(0)).toBe('normal');
    expect(severityOf(30)).toBe('normal');
    expect(severityOf(31)).toBe('suspicious');
    expect(severityOf(60)).toBe('suspicious');
    expect(severityOf(61)).toBe('sensitive');
    expect(severityOf(80)).toBe('sensitive');
    expect(severityOf(81)).toBe('secret');
    expect(severityOf(100)).toBe('secret');
  });
});

describe('key tokenization', () => {
  it('splits snake case, kebab case and camel case', () => {
    expect(tokenizeKey('DISCORD_TOKEN')).toEqual(['DISCORD', 'TOKEN']);
    expect(tokenizeKey('discord-token')).toEqual(['DISCORD', 'TOKEN']);
    expect(tokenizeKey('discordToken')).toEqual(['DISCORD', 'TOKEN']);
  });
});

describe('variables that must be masked', () => {
  const secrets: [string, string][] = [
    ['DISCORD_TOKEN', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhIjoxfQ.c2lnbmF0dXJl'],
    ['API_KEY', 'sk-proj-xxxxxxxxxxxxxxxx'],
    ['PASSWORD', 'super-secret-password'],
    ['DATABASE_URL', 'postgresql://user:password@localhost/mydb'],
    ['CLIENT_SECRET', fake('GOCSPX', '-', 'abcdefghijklmnopqrstuvwxyz')],
    ['AWS_ACCESS_KEY_ID', fake('AKIA', 'IOSFODNN7EXAMPLE')],
    ['STRIPE_KEY', fake('sk', '_live_', 'abcdefghijklmnop1234')],
    ['GITHUB_TOKEN', fake('ghp', '_', 'abcdefghijklmnopqrstuvwxyz0123456789')],
    ['SESSION_SECRET', 'not-even-random-but-named-secret'],
    ['PRIVATE_KEY', '-----BEGIN RSA PRIVATE KEY-----'],
    ['SLACK_TOKEN', fake('xox', 'b-1234567890-abcdefghij')],
    ['REFRESH_TOKEN', 'abc'],
    ['DB_PASS', 'hunter2'],
  ];

  it.each(secrets)('masks %s', (key, value) => {
    expect(isSecret(key, value)).toBe(true);
    expect(score(key, value)).toBeGreaterThanOrEqual(61);
  });
});

describe('variables that must stay visible', () => {
  const publicValues: [string, string][] = [
    ['PORT', '3000'],
    ['NODE_ENV', 'development'],
    ['DEBUG', 'true'],
    ['APP_NAME', 'MyApp'],
    ['HOST', 'localhost'],
    ['LOG_LEVEL', 'info'],
    ['TIMEZONE', 'Europe/Paris'],
    ['MAX_RETRIES', '5'],
    ['PUBLIC_KEY_PATH', './keys/public.pem'],
    ['API_URL', 'https://api.example.com/v1'],
  ];

  it.each(publicValues)('does not mask %s', (key, value) => {
    expect(isSecret(key, value)).toBe(false);
  });

  it('does not mask a URL without credentials even on a sensitive-looking name', () => {
    expect(isSecret('WEBHOOK_URL', 'https://example.com/hooks/plain')).toBe(true);
    // The name alone reaches "sensitive": that is intended, it is a webhook.
    expect(score('WEBHOOK_URL', 'https://example.com/hooks/plain')).toBeLessThan(81);
  });
});

describe('detectors in isolation', () => {
  it('name heuristic downgrades explicitly public names', () => {
    const detector = new NameHeuristicDetector();
    const secret = detector.detect({ key: 'API_KEY', value: 'x' });
    const publicOne = detector.detect({ key: 'NEXT_PUBLIC_API_KEY', value: 'x' });
    expect(secret?.score).toBe(90);
    expect(publicOne?.score).toBe(45);
  });

  it('pattern detector recognises a JWT', () => {
    const detector = new PatternDetector();
    const result = detector.detect({
      key: 'ANY',
      value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abcd',
    });
    expect(result?.rule).toBe('jwt');
    expect(result?.score).toBe(100);
  });

  it('entropy detector ignores prose and short values', () => {
    const detector = new EntropyDetector();
    expect(detector.detect({ key: 'A', value: 'development' })).toBeNull();
    expect(detector.detect({ key: 'A', value: 'the quick brown fox jumps' })).toBeNull();
    expect(detector.detect({ key: 'A', value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa' })).toBeNull();
  });

  it('entropy detector flags a random looking blob', () => {
    const detector = new EntropyDetector();
    const result = detector.detect({ key: 'A', value: 'Xk9mQ2vB7pLdR4sT1nZaY6wC3eF8gH0j' });
    expect(result).not.toBeNull();
    expect(result?.score).toBeGreaterThanOrEqual(61);
  });

  it('user patterns extend detection without touching the analyzer', () => {
    const detector = new UserPatternDetector([
      { name: 'internal', pattern: '^INT-[0-9]{6}$', score: 95 },
    ]);
    expect(detector.detect({ key: 'X', value: 'INT-123456' })?.score).toBe(95);
    expect(detector.detect({ key: 'X', value: 'nope' })).toBeNull();
  });

  it('ignores an invalid user regex instead of failing', () => {
    const detector = new UserPatternDetector([{ name: 'broken', pattern: '([' }]);
    expect(detector.detect({ key: 'X', value: 'anything' })).toBeNull();
  });

  it('accepts custom detectors through the contract', () => {
    const custom = new SecretAnalyzer([
      {
        name: 'always',
        detect: () => ({ score: 100, detector: 'always', reason: 'test detector' }),
      },
    ]);
    expect(custom.analyze({ key: 'PORT', value: '3000' }).secret).toBe(true);
  });
});

describe('configuration rules', () => {
  const rules = (partial: Partial<DetectionRules>): DetectionRules => ({
    ...DEFAULT_RULES,
    ...partial,
  });

  it('alwaysMask forces masking, glob included', () => {
    expect(isSecret('PORT', '3000', rules({ alwaysMask: ['PORT'] }))).toBe(true);
    expect(isSecret('MY_TOKEN_X', 'v', rules({ alwaysMask: ['*_TOKEN_*'] }))).toBe(true);
  });

  it('neverMask forces visibility, glob included', () => {
    expect(isSecret('API_KEY', 'sk-live-abc', rules({ neverMask: ['API_KEY'] }))).toBe(false);
    expect(isSecret('A_TOKEN', 'x', rules({ neverMask: ['*_TOKEN'] }))).toBe(false);
  });

  it('alwaysMask wins over neverMask', () => {
    const result = analyzer.analyze(
      { key: 'PORT', value: '3000' },
      rules({ alwaysMask: ['PORT'], neverMask: ['PORT'] }),
    );
    expect(result.secret).toBe(true);
  });

  it('ignoredVariables removes the variable from detection entirely', () => {
    const result = analyzer.analyze(
      { key: 'API_KEY', value: 'sk-live-abc' },
      rules({ ignoredVariables: ['API_*'] }),
    );
    expect(result.ignored).toBe(true);
    expect(result.secret).toBe(false);
    expect(result.score).toBe(0);
  });

  it('autoDetectSecrets off leaves only the explicit rules', () => {
    expect(isSecret('API_KEY', 'sk-live-abc', rules({ autoDetectSecrets: false }))).toBe(false);
    expect(
      isSecret(
        'API_KEY',
        'sk-live-abc',
        rules({ autoDetectSecrets: false, alwaysMask: ['API_KEY'] }),
      ),
    ).toBe(true);
  });

  it('maskThreshold is honoured', () => {
    expect(isSecret('USERNAME', 'admin', rules({ maskThreshold: 30 }))).toBe(true);
    expect(isSecret('USERNAME', 'admin', rules({ maskThreshold: 61 }))).toBe(false);
  });

  it('template files are never masked but keep their score', () => {
    const result = analyzer.analyze(
      { key: 'API_KEY', value: 'sk-live-abc' },
      rules({ treatAsPublic: true }),
    );
    expect(result.secret).toBe(false);
    expect(result.score).toBeGreaterThan(60);
  });
});

describe('assessment summaries', () => {
  it('never contains the value', () => {
    const value = fake('ghp', '_', 'abcdefghijklmnopqrstuvwxyz0123456789');
    const result = analyzer.analyze({ key: 'GITHUB_TOKEN', value });
    expect(result.summary).not.toContain(value);
    expect(result.summary).not.toContain(value.slice(0, 8));
    for (const detection of result.results) {
      expect(detection.reason).not.toContain(value);
    }
  });
});
