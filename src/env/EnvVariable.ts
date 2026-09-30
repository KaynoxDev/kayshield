/**
 * Builds the view models consumed by the editor, the tree view and the status
 * bar from a parsed document.
 *
 * The two models are intentionally different:
 *  - {@link EnvironmentVariable} carries the real value and never leaves the
 *    extension host.
 *  - {@link MaskedVariable} is what crosses the webview boundary; for a secret
 *    it only ever contains mask characters.
 *
 * Pure module: no `vscode` import.
 */

import type {
  DetectionRules,
  EnvDocumentAst,
  EnvironmentVariable,
  EnvVariableNode,
  MaskedVariable,
} from '../types';
import type { MaskingEngine } from '../security/MaskingEngine';
import type { SecretAnalyzer } from '../security/SecretDetector';

export interface BuildContext {
  readonly analyzer: SecretAnalyzer;
  readonly rules: DetectionRules;
  /** Ids explicitly revealed by the user. Ignored while protection is engaged. */
  readonly revealed: ReadonlySet<string>;
  /** True when Streamer Mode / Screen Safe forces everything to stay masked. */
  readonly forceMask: boolean;
}

/** Analyzes one parsed entry and produces the host-side model. */
export function buildVariable(node: EnvVariableNode, context: BuildContext): EnvironmentVariable {
  const assessment = context.analyzer.analyze({ key: node.key, value: node.value }, context.rules);
  const revealed = !context.forceMask && context.revealed.has(node.id);
  return {
    id: node.id,
    key: node.key,
    value: node.value,
    secret: assessment.secret,
    masked: assessment.secret && !revealed,
    line: node.line,
    score: assessment.score,
    severity: assessment.severity,
    summary: assessment.summary,
  };
}

/** Analyzes a whole document. */
export function buildVariables(ast: EnvDocumentAst, context: BuildContext): EnvironmentVariable[] {
  return ast.variables.map((node) => buildVariable(node, context));
}

/**
 * Projects host-side variables into the shape sent to the webview.
 *
 * SECURITY INVARIANT: `display` is masked for every secret, whatever the reveal
 * state. A revealed value never travels inside a bulk payload; it is delivered
 * on its own, one variable at a time, by the dedicated `value` message. That
 * keeps "how many plaintext values left the host" equal to "how many reveals
 * the user asked for".
 */
export function toMaskedVariable(
  variable: EnvironmentVariable,
  masking: MaskingEngine,
): MaskedVariable {
  return {
    id: variable.id,
    key: variable.key,
    display: variable.secret ? masking.mask(variable.value) : variable.value,
    masked: variable.masked,
    secret: variable.secret,
    empty: variable.value.length === 0,
    line: variable.line,
    severity: variable.severity,
    score: variable.score,
    summary: variable.summary,
  };
}

export function toMaskedVariables(
  variables: readonly EnvironmentVariable[],
  masking: MaskingEngine,
): MaskedVariable[] {
  return variables.map((variable) => toMaskedVariable(variable, masking));
}

/** Counts how many entries would be hidden. Used by the status bar and scans. */
export function countSecrets(variables: readonly EnvironmentVariable[]): number {
  return variables.filter((variable) => variable.secret).length;
}
