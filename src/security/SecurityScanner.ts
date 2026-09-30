/**
 * Scans text for hardcoded credentials.
 *
 * This is the human-error guard: a token pasted into `config.json`, a password
 * left in `docker-compose.yml`, an API key committed to `settings.toml`.
 *
 * The scanner is line based and format agnostic on purpose. Parsing YAML or
 * TOML properly would mean pulling dependencies in, and a structural parse buys
 * nothing here: we only need `key` and `value` pairs.
 *
 * SECURITY: a {@link SecretFinding} never contains the value, not even a
 * fragment of it. Only the key, the position and a value-free explanation.
 *
 * Pure module: no `vscode` import, no filesystem access.
 */

import type { DetectionRules, SecretSeverity } from '../types';
import { parseEnv } from '../env/EnvParser';
import { SecretAnalyzer } from './SecretDetector';

export type ScanKind = 'env' | 'structured';

export interface SecretFinding {
  /** Zero-based line. */
  readonly line: number;
  /** Zero-based column of the key. */
  readonly column: number;
  /** Length of the key, for range highlighting. */
  readonly length: number;
  readonly key: string;
  readonly score: number;
  readonly severity: SecretSeverity;
  /** Value-free explanation. */
  readonly summary: string;
}

/** `"key": "value"`, `key: value`, `key = "value"` on a single line. */
const STRUCTURED_ASSIGNMENT =
  /^(\s*)(?:-\s*)?["']?([A-Za-z_$][\w.$-]*)["']?\s*[:=]\s*(.+?)\s*,?\s*$/;

function stripQuotes(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0) {
    return null;
  }
  // Structure openers carry no value of their own.
  if (value === '{' || value === '[' || value === '|' || value === '>') {
    return null;
  }
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' || first === "'") && last === first && value.length >= 2) {
    return value.slice(1, -1);
  }
  return value;
}

export class SecurityScanner {
  constructor(private readonly analyzer: SecretAnalyzer = new SecretAnalyzer()) {}

  /** Scans a document and returns everything at or above `minimumScore`. */
  scan(text: string, kind: ScanKind, rules: DetectionRules, minimumScore = 61): SecretFinding[] {
    return kind === 'env'
      ? this.scanEnv(text, rules, minimumScore)
      : this.scanStructured(text, rules, minimumScore);
  }

  private scanEnv(text: string, rules: DetectionRules, minimumScore: number): SecretFinding[] {
    const ast = parseEnv(text);
    const findings: SecretFinding[] = [];
    for (const variable of ast.variables) {
      const assessment = this.analyzer.analyze({ key: variable.key, value: variable.value }, rules);
      if (assessment.ignored || assessment.score < minimumScore) {
        continue;
      }
      findings.push({
        line: variable.keyRange.startLine,
        column: variable.keyRange.startColumn,
        length: variable.key.length,
        key: variable.key,
        score: assessment.score,
        severity: assessment.severity,
        summary: assessment.summary,
      });
    }
    return findings;
  }

  private scanStructured(
    text: string,
    rules: DetectionRules,
    minimumScore: number,
  ): SecretFinding[] {
    const findings: SecretFinding[] = [];
    const lines = text.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] as string;
      if (line.length === 0 || line.length > 4096) {
        continue;
      }
      const match = STRUCTURED_ASSIGNMENT.exec(line);
      if (!match) {
        continue;
      }
      const key = match[2] as string;
      const value = stripQuotes(match[3] as string);
      if (value === null) {
        continue;
      }

      const assessment = this.analyzer.analyze({ key, value }, rules);
      if (assessment.ignored || assessment.score < minimumScore) {
        continue;
      }
      findings.push({
        line: index,
        column: line.indexOf(key),
        length: key.length,
        key,
        score: assessment.score,
        severity: assessment.severity,
        summary: assessment.summary,
      });
    }

    return findings;
  }
}

/** Picks the scan strategy from a file name. */
export function scanKindFor(fileName: string): ScanKind {
  const lower = fileName.toLowerCase();
  return lower.startsWith('.env') || lower.endsWith('.env') ? 'env' : 'structured';
}
