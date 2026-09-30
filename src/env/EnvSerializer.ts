/**
 * Turns edits into the smallest possible text change.
 *
 * EnvShield never rewrites a whole `.env` file to change one value: it produces
 * a replacement for the value range only, so comments, spacing, ordering and
 * unrelated formatting are untouched, and Git diffs stay one line long.
 *
 * Pure module: no `vscode` import.
 */

import type { EnvDocumentAst, EnvVariableNode, QuoteStyle, TextRange } from '../types';

export interface TextEditDescriptor {
  readonly range: TextRange;
  readonly newText: string;
}

/** Characters that force quoting when a value is written unquoted. */
const NEEDS_QUOTES = /[\s#"'`\\]|^$/;

function escapeForDoubleQuotes(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

/**
 * Formats a value as source text, preserving the original quoting style when it
 * still round-trips, and upgrading to double quotes when it no longer does.
 */
export function formatValue(value: string, preferred: QuoteStyle = 'none'): string {
  // An empty value stays `KEY=`, exactly as dotenv writes it.
  if (value === '' && preferred === 'none') {
    return '';
  }
  const hasNewline = /[\r\n]/.test(value);

  if (!hasNewline) {
    if (preferred === 'single' && !value.includes("'")) {
      return `'${value}'`;
    }
    if (preferred === 'backtick' && !value.includes('`') && !value.includes('\\')) {
      return `\`${value}\``;
    }
    if (preferred === 'none' && !NEEDS_QUOTES.test(value)) {
      return value;
    }
  }

  return `"${escapeForDoubleQuotes(value)}"`;
}

/** Builds the minimal edit that changes one variable's value. */
export function buildValueEdit(variable: EnvVariableNode, newValue: string): TextEditDescriptor {
  return {
    range: variable.valueRange,
    newText: formatValue(newValue, variable.quote),
  };
}

/** Builds the minimal edit that renames one variable. */
export function buildRenameEdit(variable: EnvVariableNode, newKey: string): TextEditDescriptor {
  return { range: variable.keyRange, newText: newKey };
}

/**
 * Builds the edit that removes a variable, including its trailing line break.
 * Comments above the variable are intentionally left in place: they may belong
 * to a block rather than to this single entry.
 */
export function buildDeleteEdit(variable: EnvVariableNode): TextEditDescriptor {
  return {
    range: {
      startLine: variable.line,
      startColumn: 0,
      endLine: variable.endLine + 1,
      endColumn: 0,
    },
    newText: '',
  };
}

/** Builds the edit that appends a new variable at the end of the document. */
export function buildAppendEdit(
  ast: EnvDocumentAst,
  key: string,
  value: string,
): TextEditDescriptor {
  const last = ast.nodes[ast.nodes.length - 1];
  const lastLine =
    last === undefined ? 0 : (last.kind === 'variable' ? last.endLine : last.line) + 1;
  const prefix = ast.endsWithNewline || ast.nodes.length === 0 ? '' : ast.eol;
  return {
    range: { startLine: lastLine, startColumn: 0, endLine: lastLine, endColumn: 0 },
    newText: `${prefix}${key}=${formatValue(value)}${ast.eol}`,
  };
}

/**
 * Applies edits to raw text. Used by unit tests and by any consumer that is not
 * backed by a `vscode.TextDocument`.
 */
export function applyEdits(text: string, edits: readonly TextEditDescriptor[]): string {
  const eolIsCrlf = text.includes('\r\n');
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  const offsetOf = (line: number, column: number): number => {
    let offset = 0;
    for (let index = 0; index < line; index += 1) {
      offset += (lines[index]?.length ?? 0) + 1;
    }
    return offset + column;
  };

  const flat = lines.join('\n');
  const sorted = [...edits].sort(
    (a, b) =>
      offsetOf(b.range.startLine, b.range.startColumn) -
      offsetOf(a.range.startLine, a.range.startColumn),
  );

  let result = flat;
  for (const edit of sorted) {
    const start = offsetOf(edit.range.startLine, edit.range.startColumn);
    const end = Math.min(offsetOf(edit.range.endLine, edit.range.endColumn), result.length);
    const newText = edit.newText.replace(/\r\n/g, '\n');
    result = result.slice(0, start) + newText + result.slice(end);
  }

  return eolIsCrlf ? result.replace(/\n/g, '\r\n') : result;
}
