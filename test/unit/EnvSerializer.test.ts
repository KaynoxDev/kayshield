import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/env/EnvParser';
import {
  applyEdits,
  buildAppendEdit,
  buildDeleteEdit,
  buildRenameEdit,
  buildValueEdit,
  formatValue,
} from '../../src/env/EnvSerializer';

function edit(source: string, key: string, value: string): string {
  const ast = parseEnv(source);
  const node = ast.variables.find((variable) => variable.key === key);
  if (!node) {
    throw new Error(`missing ${key}`);
  }
  return applyEdits(source, [buildValueEdit(node, value)]);
}

describe('formatValue', () => {
  it('leaves a simple value unquoted', () => {
    expect(formatValue('3000')).toBe('3000');
  });

  it('keeps an empty value unquoted', () => {
    expect(formatValue('')).toBe('');
  });

  it('quotes values containing spaces or hashes', () => {
    expect(formatValue('hello world')).toBe('"hello world"');
    expect(formatValue('a#b')).toBe('"a#b"');
  });

  it('preserves the original quoting style when it still round-trips', () => {
    expect(formatValue('plain', 'single')).toBe("'plain'");
    expect(formatValue('plain', 'backtick')).toBe('`plain`');
  });

  it('upgrades to double quotes when the original style would break', () => {
    expect(formatValue("it's", 'single')).toBe('"it\'s"');
  });

  it('escapes newlines rather than writing a raw line break', () => {
    expect(formatValue('a\nb')).toBe('"a\\nb"');
  });

  it('escapes backslashes and double quotes', () => {
    expect(formatValue('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});

describe('surgical edits', () => {
  it('rewrites only the value, keeping comments and spacing byte for byte', () => {
    const source = [
      '# Database configuration',
      '',
      'DATABASE_URL=postgresql://old   # inline note',
      'PORT   =   3000',
      '',
      '# trailing comment',
      '',
    ].join('\n');

    const result = edit(source, 'DATABASE_URL', 'postgresql://new');

    expect(result).toBe(
      [
        '# Database configuration',
        '',
        'DATABASE_URL=postgresql://new   # inline note',
        'PORT   =   3000',
        '',
        '# trailing comment',
        '',
      ].join('\n'),
    );
  });

  it('changes a single line only', () => {
    const source = 'A=1\nB=2\nC=3\n';
    const result = edit(source, 'B', '22');
    const changed = result.split('\n').filter((line, index) => line !== source.split('\n')[index]);
    expect(changed).toEqual(['B=22']);
  });

  it('preserves quoting style across an edit', () => {
    expect(edit("A='old'\n", 'A', 'new')).toBe("A='new'\n");
    expect(edit('A="old"\n', 'A', 'new')).toBe('A="new"\n');
  });

  it('fills an empty value without touching the rest', () => {
    expect(edit('EMPTY=\nB=2\n', 'EMPTY', 'now set')).toBe('EMPTY="now set"\nB=2\n');
  });

  it('replaces a multiline value as one unit', () => {
    const source = 'M="a\nb"\nAFTER=1\n';
    expect(edit(source, 'M', 'single')).toBe('M="single"\nAFTER=1\n');
  });

  it('preserves the export prefix', () => {
    expect(edit('export A=1\n', 'A', '2')).toBe('export A=2\n');
  });

  it('renames a key without touching its value', () => {
    const ast = parseEnv('OLD_NAME=value # keep\n');
    const node = ast.variables[0];
    if (!node) {
      throw new Error('missing node');
    }
    expect(applyEdits('OLD_NAME=value # keep\n', [buildRenameEdit(node, 'NEW_NAME')])).toBe(
      'NEW_NAME=value # keep\n',
    );
  });

  it('deletes a whole entry, leaving neighbours untouched', () => {
    const source = 'A=1\nB=2\nC=3\n';
    const ast = parseEnv(source);
    const node = ast.variables[1];
    if (!node) {
      throw new Error('missing node');
    }
    expect(applyEdits(source, [buildDeleteEdit(node)])).toBe('A=1\nC=3\n');
  });

  it('appends a variable at the end of the document', () => {
    const source = 'A=1\n';
    const ast = parseEnv(source);
    expect(applyEdits(source, [buildAppendEdit(ast, 'B', 'two words')])).toBe(
      'A=1\nB="two words"\n',
    );
  });

  it('appends a newline first when the file does not end with one', () => {
    const source = 'A=1';
    const ast = parseEnv(source);
    expect(applyEdits(source, [buildAppendEdit(ast, 'B', '2')])).toBe('A=1\nB=2\n');
  });

  it('keeps CRLF documents in CRLF', () => {
    const source = 'A=1\r\nB=2\r\n';
    const result = edit(source, 'A', '9');
    expect(result).toBe('A=9\r\nB=2\r\n');
  });

  it('round-trips a document when nothing is edited', () => {
    const source = '# c\n\nexport A="x y" # note\nB=\n';
    expect(applyEdits(source, [])).toBe(source);
  });
});
