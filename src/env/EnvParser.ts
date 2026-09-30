/**
 * Robust, allocation-light `.env` parser.
 *
 * Design goals, in order:
 *  1. Never lose information. Every source line ends up in exactly one node,
 *     including comments, blank lines and lines we do not understand.
 *  2. Record precise ranges so a single value can be rewritten without
 *     touching the rest of the file.
 *  3. Match dotenv semantics closely enough that what EnvShield shows is what
 *     Node.js, Python, Docker and .NET will load.
 *
 * Pure module: no `vscode` import.
 */

import type {
  Eol,
  EnvDocumentAst,
  EnvNode,
  EnvVariableNode,
  QuoteStyle,
  TextRange,
} from '../types';

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*/;
const EXPORT_PREFIX = /^export[ \t]+/;

interface ValueScan {
  readonly value: string;
  readonly quote: QuoteStyle;
  readonly range: TextRange;
  readonly inlineComment: string | undefined;
  /** Index of the last consumed line. */
  readonly endLine: number;
}

/** Detects the dominant line ending so serialization stays consistent. */
export function detectEol(text: string): Eol {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

function unescapeDoubleQuoted(raw: string): string {
  let result = '';
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char !== '\\') {
      result += char;
      continue;
    }
    const next = raw[index + 1];
    index += 1;
    switch (next) {
      case 'n':
        result += '\n';
        break;
      case 'r':
        result += '\r';
        break;
      case 't':
        result += '\t';
        break;
      case 'b':
        result += '\b';
        break;
      case 'f':
        result += '\f';
        break;
      case '\\':
        result += '\\';
        break;
      case '"':
        result += '"';
        break;
      case "'":
        result += "'";
        break;
      case '`':
        result += '`';
        break;
      case undefined:
        result += '\\';
        break;
      default:
        // Unknown escape: keep it verbatim, exactly like dotenv does.
        result += `\\${next}`;
        break;
    }
  }
  return result;
}

function quoteStyleOf(char: string): QuoteStyle | undefined {
  if (char === '"') {
    return 'double';
  }
  if (char === "'") {
    return 'single';
  }
  if (char === '`') {
    return 'backtick';
  }
  return undefined;
}

/**
 * Scans a value starting at `column` on `lines[lineIndex]`.
 * Quoted values may span several lines; unquoted values never do.
 */
function scanValue(lines: readonly string[], lineIndex: number, column: number): ValueScan {
  const line = lines[lineIndex] ?? '';
  const first = line[column];
  const quote = first === undefined ? undefined : quoteStyleOf(first);

  if (quote === undefined) {
    return scanUnquoted(line, lineIndex, column);
  }

  const quoteChar = first as string;
  const escapable = quote !== 'single';
  let currentLine = lineIndex;
  let cursor = column + 1;
  let rawInner = '';

  for (;;) {
    const text = lines[currentLine];
    if (text === undefined) {
      // Unterminated quote: fall back to a single-line unquoted read so the
      // rest of the document still parses.
      return scanUnquoted(line, lineIndex, column);
    }
    let closed = -1;
    for (let index = cursor; index < text.length; index += 1) {
      const char = text[index];
      if (escapable && char === '\\') {
        index += 1;
        continue;
      }
      if (char === quoteChar) {
        closed = index;
        break;
      }
    }
    if (closed >= 0) {
      rawInner += text.slice(cursor, closed);
      const after = text.slice(closed + 1);
      const commentMatch = /^\s*(#.*)$/.exec(after);
      return {
        value: escapable ? unescapeDoubleQuoted(rawInner) : rawInner,
        quote,
        range: {
          startLine: lineIndex,
          startColumn: column,
          endLine: currentLine,
          endColumn: closed + 1,
        },
        inlineComment: commentMatch?.[1],
        endLine: currentLine,
      };
    }
    rawInner += `${text.slice(cursor)}\n`;
    currentLine += 1;
    cursor = 0;
    if (currentLine >= lines.length) {
      return scanUnquoted(line, lineIndex, column);
    }
  }
}

function scanUnquoted(line: string, lineIndex: number, column: number): ValueScan {
  const rest = line.slice(column);

  // `KEY= # comment` - the value is empty and everything after is a comment.
  if (rest.startsWith('#')) {
    return {
      value: '',
      quote: 'none',
      range: { startLine: lineIndex, startColumn: column, endLine: lineIndex, endColumn: column },
      inlineComment: rest,
      endLine: lineIndex,
    };
  }

  // An inline comment requires whitespace before `#`, so URLs such as
  // https://example.com/#anchor stay intact - same rule as dotenv.
  const commentMatch = /\s#/.exec(rest);
  const rawValue = commentMatch ? rest.slice(0, commentMatch.index) : rest;
  const trimmed = rawValue.replace(/[ \t]+$/, '');

  return {
    value: trimmed,
    quote: 'none',
    range: {
      startLine: lineIndex,
      startColumn: column,
      endLine: lineIndex,
      endColumn: column + trimmed.length,
    },
    inlineComment: commentMatch ? rest.slice(commentMatch.index + 1) : undefined,
    endLine: lineIndex,
  };
}

/**
 * Parses `.env` content into an AST that preserves comments, blank lines,
 * ordering, quoting and inline comments.
 */
export function parseEnv(text: string): EnvDocumentAst {
  const eol = detectEol(text);
  const endsWithNewline = /\r?\n$/.test(text);
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  // A trailing newline produces an empty final element that is not a real line.
  if (endsWithNewline) {
    lines.pop();
  }

  const nodes: EnvNode[] = [];
  const variables: EnvVariableNode[] = [];
  const usedIds = new Set<string>();

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] as string;
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      nodes.push({ kind: 'blank', line: lineIndex, raw: line });
      continue;
    }
    if (trimmed.startsWith('#')) {
      nodes.push({ kind: 'comment', line: lineIndex, raw: line, text: trimmed.slice(1).trim() });
      continue;
    }

    let column = 0;
    while (column < line.length && (line[column] === ' ' || line[column] === '\t')) {
      column += 1;
    }

    let exported = false;
    const exportMatch = EXPORT_PREFIX.exec(line.slice(column));
    if (exportMatch) {
      exported = true;
      column += exportMatch[0].length;
    }

    const keyMatch = KEY_PATTERN.exec(line.slice(column));
    if (!keyMatch) {
      nodes.push({ kind: 'unknown', line: lineIndex, raw: line });
      continue;
    }

    const key = keyMatch[0];
    const keyStart = column;
    column += key.length;
    const keyEnd = column;

    while (column < line.length && (line[column] === ' ' || line[column] === '\t')) {
      column += 1;
    }
    if (line[column] !== '=') {
      nodes.push({ kind: 'unknown', line: lineIndex, raw: line });
      continue;
    }
    column += 1;
    while (column < line.length && (line[column] === ' ' || line[column] === '\t')) {
      column += 1;
    }

    const scan = scanValue(lines, lineIndex, column);
    const raw = lines.slice(lineIndex, scan.endLine + 1).join('\n');

    let id = `${key}@${lineIndex}`;
    while (usedIds.has(id)) {
      id = `${id}_`;
    }
    usedIds.add(id);

    const node: EnvVariableNode = {
      kind: 'variable',
      id,
      key,
      value: scan.value,
      raw,
      line: lineIndex,
      endLine: scan.endLine,
      exported,
      quote: scan.quote,
      inlineComment: scan.inlineComment,
      valueRange: scan.range,
      keyRange: {
        startLine: lineIndex,
        startColumn: keyStart,
        endLine: lineIndex,
        endColumn: keyEnd,
      },
    };

    nodes.push(node);
    variables.push(node);
    lineIndex = scan.endLine;
  }

  return { nodes, variables, eol, endsWithNewline };
}

/**
 * Convenience view used by consumers that only need the effective environment,
 * mirroring what dotenv would load (last assignment wins).
 */
export function toRecord(ast: EnvDocumentAst): Record<string, string> {
  const record: Record<string, string> = {};
  for (const variable of ast.variables) {
    record[variable.key] = variable.value;
  }
  return record;
}
