/**
 * Core domain types shared across KayShield.
 *
 * SECURITY: nothing in this file (or in anything it imports) may depend on the
 * `vscode` module. The parsing and detection layers are deliberately pure so they
 * can be unit tested, audited and reused by future providers (JSON, YAML, TOML).
 */

/** Quoting style used by a value in the source file. */
export type QuoteStyle = 'none' | 'double' | 'single' | 'backtick';

/** A zero-based range inside a text document. */
export interface TextRange {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

/** A parsed `KEY=value` entry, with everything needed for surgical edits. */
export interface EnvVariableNode {
  readonly kind: 'variable';
  /** Stable identifier within a document (`key@line`). */
  readonly id: string;
  readonly key: string;
  /** Decoded value: quotes removed, escapes expanded for double-quoted values. */
  readonly value: string;
  /** Raw source text of the whole entry, including quotes and inline comment. */
  readonly raw: string;
  readonly line: number;
  readonly endLine: number;
  readonly exported: boolean;
  readonly quote: QuoteStyle;
  /** Inline comment text, including the leading `#`, when present. */
  readonly inlineComment: string | undefined;
  /** Range of the raw value token (quotes included). Used for incremental edits. */
  readonly valueRange: TextRange;
  readonly keyRange: TextRange;
}

export interface EnvCommentNode {
  readonly kind: 'comment';
  readonly line: number;
  readonly raw: string;
  readonly text: string;
}

export interface EnvBlankNode {
  readonly kind: 'blank';
  readonly line: number;
  readonly raw: string;
}

/** A line we could not interpret. Preserved verbatim, never rewritten. */
export interface EnvUnknownNode {
  readonly kind: 'unknown';
  readonly line: number;
  readonly raw: string;
}

export type EnvNode = EnvVariableNode | EnvCommentNode | EnvBlankNode | EnvUnknownNode;

export type Eol = '\n' | '\r\n';

/** Full parse result for one environment document. */
export interface EnvDocumentAst {
  readonly nodes: readonly EnvNode[];
  readonly variables: readonly EnvVariableNode[];
  readonly eol: Eol;
  /** True when the source text ended with a line terminator. */
  readonly endsWithNewline: boolean;
}

/* -------------------------------------------------------------------------- */
/* Secret detection                                                            */
/* -------------------------------------------------------------------------- */

export type SecretSeverity = 'normal' | 'suspicious' | 'sensitive' | 'secret';

/** Score bands, as specified by the KayShield scoring model. */
export const SEVERITY_BANDS = {
  normal: { min: 0, max: 30 },
  suspicious: { min: 31, max: 60 },
  sensitive: { min: 61, max: 80 },
  secret: { min: 81, max: 100 },
} as const;

/** What a detector receives. Never widen this to include file contents. */
export interface DetectionInput {
  readonly key: string;
  readonly value: string;
}

export interface DetectionResult {
  /** 0-100. */
  readonly score: number;
  /** Identifier of the detector that produced the result. */
  readonly detector: string;
  /**
   * Human readable justification.
   * SECURITY: must never embed the value or any fragment of it.
   */
  readonly reason: string;
  /** Name of the matched rule, when the detector is pattern based. */
  readonly rule?: string;
}

/**
 * Extension point. New detectors (cloud providers, internal formats, ML based
 * heuristics) can be registered without touching the analyzer.
 */
export interface SecretDetectorContract {
  readonly name: string;
  detect(input: DetectionInput): DetectionResult | null;
}

/** Rules coming from user configuration. */
export interface DetectionRules {
  readonly alwaysMask: readonly string[];
  readonly neverMask: readonly string[];
  readonly ignoredVariables: readonly string[];
  readonly autoDetectSecrets: boolean;
  readonly maskThreshold: number;
  /** True for files such as `.env.example` that are considered public. */
  readonly treatAsPublic?: boolean;
}

export interface SecretAssessment {
  readonly score: number;
  readonly severity: SecretSeverity;
  /** True when the value must be masked. */
  readonly secret: boolean;
  /** True when the variable is excluded from detection and scanning. */
  readonly ignored: boolean;
  readonly results: readonly DetectionResult[];
  /** Short, value-free explanation suitable for tooltips and diagnostics. */
  readonly summary: string;
}

/* -------------------------------------------------------------------------- */
/* View model                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The shape handed to the UI layers. `value` is only ever populated on the
 * extension host side; the webview receives {@link MaskedVariable} instead.
 */
export interface EnvironmentVariable {
  readonly id: string;
  readonly key: string;
  readonly value: string;
  readonly masked: boolean;
  readonly secret: boolean;
  readonly line: number;
  readonly score: number;
  readonly severity: SecretSeverity;
  readonly summary: string;
}

/**
 * What actually crosses the extension-host / webview boundary.
 *
 * SECURITY: `display` holds mask characters for every secret variable. The real
 * value is only sent later, for one variable at a time, after an explicit user
 * reveal.
 */
export interface MaskedVariable {
  readonly id: string;
  readonly key: string;
  readonly display: string;
  readonly masked: boolean;
  readonly secret: boolean;
  readonly empty: boolean;
  readonly line: number;
  readonly severity: SecretSeverity;
  readonly score: number;
  readonly summary: string;
}
