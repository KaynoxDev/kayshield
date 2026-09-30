/**
 * Secret detection.
 *
 * Detection is a committee, not a single regex. Each detector returns an
 * independent opinion; {@link SecretAnalyzer} combines them into a 0-100 score
 * and a severity band. Detectors are pluggable so new providers or heuristics
 * can be added without touching the analyzer.
 *
 * Pure module: no `vscode` import, no I/O, no network.
 */

import type {
  DetectionInput,
  DetectionResult,
  DetectionRules,
  SecretAssessment,
  SecretDetectorContract,
  SecretSeverity,
} from '../types';
import { characterClasses, shannonEntropy, uniqueRatio } from '../utils/entropy';
import { matchesAnyGlob } from '../utils/glob';
import { SECRET_PATTERNS, type SecretPattern } from './SecretPatterns';

/* -------------------------------------------------------------------------- */
/* Name heuristics                                                             */
/* -------------------------------------------------------------------------- */

/** Names that almost always hold a credential. */
const STRONG_NAME_TOKENS = new Set([
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASSWD',
  'PASS',
  'PWD',
  'PASSPHRASE',
  'CREDENTIALS',
  'CREDENTIAL',
  'JWT',
  'APIKEY',
]);

/** Multi-word names that are unambiguous once the parts are joined. */
const STRONG_NAME_PHRASES = [
  'API_KEY',
  'ACCESS_KEY',
  'SECRET_KEY',
  'PRIVATE_KEY',
  'CLIENT_SECRET',
  'AUTH_TOKEN',
  'ACCESS_TOKEN',
  'REFRESH_TOKEN',
  'BOT_TOKEN',
  'SESSION_SECRET',
  'ENCRYPTION_KEY',
  'SIGNING_KEY',
  'SECRET_ACCESS_KEY',
  'SERVICE_ROLE_KEY',
  'MASTER_KEY',
];

/** Names that usually hold something sensitive, but not always. */
const ELEVATED_NAME_TOKENS = new Set([
  'KEY',
  'AUTH',
  'SALT',
  'SEED',
  'MNEMONIC',
  'SIGNATURE',
  'CERT',
  'CERTIFICATE',
  'COOKIE',
  'DSN',
  'WEBHOOK',
  'HASH',
]);

const ELEVATED_NAME_PHRASES = [
  'DATABASE_URL',
  'DB_URL',
  'CONNECTION_STRING',
  'WEBHOOK_URL',
  'LICENSE_KEY',
  'ACCOUNT_SID',
  'PRIVATE_TOKEN',
];

/** Names hinting the value is meant to be public. */
const PUBLIC_NAME_TOKENS = new Set([
  'PUBLIC',
  'PUBLISHABLE',
  'EXAMPLE',
  'SAMPLE',
  'DUMMY',
  'FAKE',
  'PLACEHOLDER',
]);

/** Names that carry identity but not access. Worth flagging, not masking. */
const WEAK_NAME_TOKENS = new Set(['USER', 'USERNAME', 'LOGIN', 'EMAIL', 'ACCOUNT']);

/** Splits `nextPublicApiKey` / `NEXT_PUBLIC_API_KEY` into uppercase tokens. */
export function tokenizeKey(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.toUpperCase());
}

export class NameHeuristicDetector implements SecretDetectorContract {
  readonly name = 'name-heuristic';

  detect(input: DetectionInput): DetectionResult | null {
    const tokens = tokenizeKey(input.key);
    if (tokens.length === 0) {
      return null;
    }
    const normalized = tokens.join('_');

    let score = 0;
    let reason = '';

    if (STRONG_NAME_PHRASES.some((phrase) => normalized.includes(phrase))) {
      score = 90;
      reason = 'Variable name matches a well-known credential name';
    } else if (tokens.some((token) => STRONG_NAME_TOKENS.has(token))) {
      score = 90;
      reason = 'Variable name contains a credential keyword';
    } else if (ELEVATED_NAME_PHRASES.some((phrase) => normalized.includes(phrase))) {
      score = 72;
      reason = 'Variable name usually holds connection credentials';
    } else if (tokens.some((token) => ELEVATED_NAME_TOKENS.has(token))) {
      score = 68;
      reason = 'Variable name suggests sensitive material';
    } else if (tokens.some((token) => WEAK_NAME_TOKENS.has(token))) {
      score = 35;
      reason = 'Variable name refers to an identity';
    } else {
      return null;
    }

    if (tokens.some((token) => PUBLIC_NAME_TOKENS.has(token))) {
      score = Math.max(0, score - 45);
      reason = `${reason}, but the name marks it as public`;
    }

    if (score === 0) {
      return null;
    }
    return { score, detector: this.name, reason };
  }
}

/* -------------------------------------------------------------------------- */
/* Known formats                                                               */
/* -------------------------------------------------------------------------- */

export class PatternDetector implements SecretDetectorContract {
  readonly name = 'known-pattern';

  constructor(private readonly patterns: readonly SecretPattern[] = SECRET_PATTERNS) {}

  detect(input: DetectionInput): DetectionResult | null {
    for (const pattern of this.patterns) {
      const subject = pattern.target === 'key' ? input.key : input.value;
      if (subject.length > 0 && pattern.regex.test(subject)) {
        return {
          score: pattern.score,
          detector: this.name,
          reason: `Matches a known secret format: ${pattern.name}`,
          rule: pattern.id,
        };
      }
    }
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Entropy                                                                     */
/* -------------------------------------------------------------------------- */

/** Values that look random but are not credentials. */
const NON_SECRET_VALUE = /^(?:true|false|null|undefined|none|localhost|\d+(?:\.\d+)*)$/i;

export class EntropyDetector implements SecretDetectorContract {
  readonly name = 'entropy';

  detect(input: DetectionInput): DetectionResult | null {
    const value = input.value;
    if (value.length < 20 || /\s/.test(value) || NON_SECRET_VALUE.test(value)) {
      return null;
    }
    // Filesystem paths and plain URLs without credentials are not secrets by
    // themselves; the pattern detector already handles credentialed URLs.
    if (/^[./~\\]/.test(value) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
      return null;
    }
    if (uniqueRatio(value) < 0.3) {
      return null;
    }

    const entropy = shannonEntropy(value);
    const classes = characterClasses(value);

    const highEntropy = value.length >= 24 && entropy >= 4 && classes.count >= 2;
    const longAndMixed = value.length >= 32 && entropy >= 3.5;
    if (!highEntropy && !longAndMixed) {
      return null;
    }

    const lengthBonus = Math.min(10, Math.floor((value.length - 20) / 8));
    const entropyBonus = Math.min(8, Math.round((entropy - 3.5) * 6));
    const score = Math.min(80, 62 + lengthBonus + entropyBonus);

    return {
      score,
      detector: this.name,
      reason: 'Value looks randomly generated (high entropy, mixed character classes)',
    };
  }
}

/* -------------------------------------------------------------------------- */
/* User supplied rules                                                         */
/* -------------------------------------------------------------------------- */

export interface UserPattern {
  readonly name: string;
  readonly pattern: string;
  readonly target?: 'value' | 'key';
  readonly score?: number;
}

export class UserPatternDetector implements SecretDetectorContract {
  readonly name = 'user-pattern';

  private readonly compiled: { pattern: UserPattern; regex: RegExp }[];

  constructor(patterns: readonly UserPattern[]) {
    this.compiled = [];
    for (const pattern of patterns) {
      try {
        this.compiled.push({ pattern, regex: new RegExp(pattern.pattern) });
      } catch {
        // An invalid user regex must never break detection for every variable.
        continue;
      }
    }
  }

  detect(input: DetectionInput): DetectionResult | null {
    for (const { pattern, regex } of this.compiled) {
      const subject = pattern.target === 'key' ? input.key : input.value;
      if (subject.length > 0 && regex.test(subject)) {
        return {
          score: clampScore(pattern.score ?? 100),
          detector: this.name,
          reason: `Matches user-defined rule: ${pattern.name}`,
          rule: pattern.name,
        };
      }
    }
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Analyzer                                                                    */
/* -------------------------------------------------------------------------- */

export function clampScore(score: number): number {
  if (Number.isNaN(score)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function severityOf(score: number): SecretSeverity {
  if (score >= 81) {
    return 'secret';
  }
  if (score >= 61) {
    return 'sensitive';
  }
  if (score >= 31) {
    return 'suspicious';
  }
  return 'normal';
}

export const DEFAULT_RULES: DetectionRules = {
  alwaysMask: [],
  neverMask: [],
  ignoredVariables: [],
  autoDetectSecrets: true,
  maskThreshold: 61,
};

/**
 * Combines every registered detector into a single assessment.
 * Registration order does not matter: the analyzer takes the strongest signal
 * and adds a small bonus when independent detectors agree.
 */
export class SecretAnalyzer {
  private readonly detectors: SecretDetectorContract[];

  constructor(detectors?: readonly SecretDetectorContract[]) {
    this.detectors = detectors
      ? [...detectors]
      : [new PatternDetector(), new NameHeuristicDetector(), new EntropyDetector()];
  }

  /** Adds a detector at runtime. Later detectors never shadow earlier ones. */
  register(detector: SecretDetectorContract): void {
    this.detectors.push(detector);
  }

  analyze(input: DetectionInput, rules: DetectionRules = DEFAULT_RULES): SecretAssessment {
    if (matchesAnyGlob(input.key, rules.ignoredVariables)) {
      return {
        score: 0,
        severity: 'normal',
        secret: false,
        ignored: true,
        results: [],
        summary: 'Ignored by configuration',
      };
    }

    const forcedMask = matchesAnyGlob(input.key, rules.alwaysMask);
    const forcedVisible = matchesAnyGlob(input.key, rules.neverMask);

    if (forcedVisible && !forcedMask) {
      return {
        score: 0,
        severity: 'normal',
        secret: false,
        ignored: false,
        results: [],
        summary: 'Never masked (configured)',
      };
    }

    const results: DetectionResult[] = [];
    for (const detector of this.detectors) {
      const result = detector.detect(input);
      if (result && result.score > 0) {
        results.push({ ...result, score: clampScore(result.score) });
      }
    }

    let score = results.reduce((max, result) => Math.max(max, result.score), 0);

    // Two independent signals agreeing is stronger than either alone.
    const strong = results.filter((result) => result.score >= 60);
    if (strong.length >= 2) {
      score = clampScore(score + 10);
    }

    if (forcedMask) {
      return {
        score: 100,
        severity: 'secret',
        secret: true,
        ignored: false,
        results,
        summary: 'Always masked (configured)',
      };
    }

    if (rules.treatAsPublic) {
      return {
        score,
        severity: severityOf(score),
        secret: false,
        ignored: false,
        results,
        summary: 'Template file: values are treated as public',
      };
    }

    const secret = rules.autoDetectSecrets && score >= rules.maskThreshold;

    return {
      score,
      severity: severityOf(score),
      secret,
      ignored: false,
      results,
      summary: summarize(results, score),
    };
  }
}

/**
 * Builds a short explanation for tooltips and diagnostics.
 * SECURITY: only detector reasons are used, and reasons never contain values.
 */
function summarize(results: readonly DetectionResult[], score: number): string {
  if (results.length === 0) {
    return 'No sensitive signal detected';
  }
  const best = results.reduce((top, result) => (result.score > top.score ? result : top));
  return `${best.reason} (score ${score}/100)`;
}

/**
 * Builds the standard detector committee, plus any user-defined patterns.
 * Callers rebuild the analyzer when configuration changes rather than pushing
 * detectors onto a live instance, so the committee never grows unbounded.
 */
export function createAnalyzer(userPatterns: readonly UserPattern[] = []): SecretAnalyzer {
  const detectors: SecretDetectorContract[] = [
    new PatternDetector(),
    new NameHeuristicDetector(),
    new EntropyDetector(),
  ];
  if (userPatterns.length > 0) {
    detectors.push(new UserPatternDetector(userPatterns));
  }
  return new SecretAnalyzer(detectors);
}
