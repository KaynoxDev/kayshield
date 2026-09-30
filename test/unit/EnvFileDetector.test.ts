import { describe, expect, it } from 'vitest';
import {
  baseName,
  classifyEnvFile,
  isEnvFile,
  isTemplateFileName,
} from '../../src/env/EnvFileDetector';
import { matchesAnyGlob, matchesGlob } from '../../src/utils/glob';
import { characterClasses, shannonEntropy, uniqueRatio } from '../../src/utils/entropy';

describe('baseName', () => {
  it('handles POSIX paths, Windows paths and URIs', () => {
    expect(baseName('/home/kay/project/.env')).toBe('.env');
    expect(baseName('C:\\projects\\app\\.env.local')).toBe('.env.local');
    expect(baseName('file:///c%3A/app/.env.production')).toBe('.env.production');
  });
});

describe('environment file detection', () => {
  const recognised = [
    '.env',
    '.env.local',
    '.env.development',
    '.env.production',
    '.env.test',
    '.env.staging',
    '.env.preview',
    'app.env',
  ];

  it.each(recognised)('recognises %s', (name) => {
    expect(isEnvFile(`/project/${name}`)).toBe(true);
  });

  const rejected = ['package.json', 'environment.ts', 'README.md', 'envy.txt'];

  it.each(rejected)('rejects %s', (name) => {
    expect(isEnvFile(`/project/${name}`)).toBe(false);
  });

  it('supports custom patterns', () => {
    expect(isEnvFile('/project/config.secrets', ['*.secrets'])).toBe(true);
    expect(isEnvFile('/project/.env', ['*.secrets'])).toBe(false);
  });
});

describe('template files', () => {
  const templates = ['.env.example', '.env.sample', '.env.template', '.env.dist', '.env.defaults'];

  it.each(templates)('%s is a template', (name) => {
    expect(isTemplateFileName(name)).toBe(true);
  });

  it('treats templates as public by default', () => {
    const classification = classifyEnvFile('/project/.env.example');
    expect(classification.isEnvFile).toBe(true);
    expect(classification.isTemplate).toBe(true);
    expect(classification.treatAsPublic).toBe(true);
  });

  it('protects templates when the user opts in', () => {
    const classification = classifyEnvFile('/project/.env.example', { protectEnvExample: true });
    expect(classification.treatAsPublic).toBe(false);
  });

  it('does not treat a real environment file as a template', () => {
    expect(classifyEnvFile('/project/.env.production').treatAsPublic).toBe(false);
  });
});

describe('glob matching', () => {
  it('supports star and question mark', () => {
    expect(matchesGlob('DISCORD_TOKEN', '*_TOKEN')).toBe(true);
    expect(matchesGlob('DISCORD_TOKENS', '*_TOKEN')).toBe(false);
    expect(matchesGlob('KEY_1', 'KEY_?')).toBe(true);
  });

  it('is case insensitive', () => {
    expect(matchesGlob('api_key', 'API_KEY')).toBe(true);
  });

  it('escapes regex metacharacters in the pattern', () => {
    expect(matchesGlob('a.b', 'a.b')).toBe(true);
    expect(matchesGlob('axb', 'a.b')).toBe(false);
  });

  it('returns false for an empty rule list', () => {
    expect(matchesAnyGlob('ANY', [])).toBe(false);
  });
});

describe('entropy helpers', () => {
  it('returns zero for an empty string', () => {
    expect(shannonEntropy('')).toBe(0);
  });

  it('grows with randomness', () => {
    expect(shannonEntropy('aaaaaaaa')).toBe(0);
    expect(shannonEntropy('abcdefgh')).toBeGreaterThan(2.9);
  });

  it('counts character classes', () => {
    expect(characterClasses('abc123XYZ!').count).toBe(4);
    expect(characterClasses('abcdef').count).toBe(1);
  });

  it('measures repetition', () => {
    expect(uniqueRatio('aaaa')).toBeCloseTo(0.25);
    expect(uniqueRatio('abcd')).toBe(1);
    expect(uniqueRatio('')).toBe(0);
  });
});
