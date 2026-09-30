import { describe, expect, it } from 'vitest';
import { detectEol, parseEnv, toRecord } from '../../src/env/EnvParser';

describe('EnvParser', () => {
  it('parses simple assignments', () => {
    const ast = parseEnv('PORT=3000\nNODE_ENV=development\n');
    expect(ast.variables).toHaveLength(2);
    expect(ast.variables[0]).toMatchObject({ key: 'PORT', value: '3000', line: 0 });
    expect(ast.variables[1]).toMatchObject({ key: 'NODE_ENV', value: 'development', line: 1 });
  });

  it('strips double quotes and expands escapes', () => {
    const ast = parseEnv('A="hello world"\nB="line\\nbreak"\n');
    expect(ast.variables[0]?.value).toBe('hello world');
    expect(ast.variables[0]?.quote).toBe('double');
    expect(ast.variables[1]?.value).toBe('line\nbreak');
  });

  it('keeps single-quoted values literal', () => {
    const ast = parseEnv("A='no \\n expansion'\n");
    expect(ast.variables[0]?.value).toBe('no \\n expansion');
    expect(ast.variables[0]?.quote).toBe('single');
  });

  it('supports backtick quoting', () => {
    const ast = parseEnv('A=`value with "quotes"`\n');
    expect(ast.variables[0]?.value).toBe('value with "quotes"');
    expect(ast.variables[0]?.quote).toBe('backtick');
  });

  it('separates inline comments from unquoted values', () => {
    const ast = parseEnv('KEY=value # a comment\n');
    expect(ast.variables[0]?.value).toBe('value');
    expect(ast.variables[0]?.inlineComment).toBe('# a comment');
  });

  it('does not treat a hash inside a URL as a comment', () => {
    const ast = parseEnv('URL=https://example.com?foo=bar#anchor\n');
    expect(ast.variables[0]?.value).toBe('https://example.com?foo=bar#anchor');
    expect(ast.variables[0]?.inlineComment).toBeUndefined();
  });

  it('keeps query strings with equals signs intact', () => {
    const ast = parseEnv('URL=https://example.com?foo=bar&baz=qux\n');
    expect(ast.variables[0]?.value).toBe('https://example.com?foo=bar&baz=qux');
  });

  it('handles empty values', () => {
    const ast = parseEnv('EMPTY=\n');
    expect(ast.variables[0]?.value).toBe('');
    expect(ast.variables[0]?.valueRange.startColumn).toBe(6);
    expect(ast.variables[0]?.valueRange.endColumn).toBe(6);
  });

  it('handles an empty value followed by a comment', () => {
    const ast = parseEnv('EMPTY= # nothing here\n');
    expect(ast.variables[0]?.value).toBe('');
    expect(ast.variables[0]?.inlineComment).toBe('# nothing here');
  });

  it('tolerates spaces around the equals sign', () => {
    const ast = parseEnv('SPACED = value\n');
    expect(ast.variables[0]).toMatchObject({ key: 'SPACED', value: 'value' });
  });

  it('supports the export prefix', () => {
    const ast = parseEnv('export API_KEY=abc\n');
    expect(ast.variables[0]).toMatchObject({ key: 'API_KEY', value: 'abc', exported: true });
  });

  it('parses multiline quoted values', () => {
    const ast = parseEnv('MULTILINE="hello\nworld"\nAFTER=1\n');
    expect(ast.variables[0]?.value).toBe('hello\nworld');
    expect(ast.variables[0]?.line).toBe(0);
    expect(ast.variables[0]?.endLine).toBe(1);
    expect(ast.variables[1]).toMatchObject({ key: 'AFTER', value: '1', line: 2 });
  });

  it('preserves comments, blank lines and ordering', () => {
    const source = '# top comment\n\nA=1\n\n# another\nB=2\n';
    const ast = parseEnv(source);
    expect(ast.nodes.map((node) => node.kind)).toEqual([
      'comment',
      'blank',
      'variable',
      'blank',
      'comment',
      'variable',
    ]);
    expect(ast.variables.map((variable) => variable.key)).toEqual(['A', 'B']);
  });

  it('keeps unparsable lines instead of dropping them', () => {
    const ast = parseEnv('this is not an assignment\nA=1\n');
    expect(ast.nodes[0]?.kind).toBe('unknown');
    expect(ast.nodes[0]?.raw).toBe('this is not an assignment');
    expect(ast.variables).toHaveLength(1);
  });

  it('detects CRLF documents', () => {
    expect(detectEol('A=1\r\nB=2\r\n')).toBe('\r\n');
    expect(detectEol('A=1\nB=2\n')).toBe('\n');
    const ast = parseEnv('A=1\r\nB=2\r\n');
    expect(ast.eol).toBe('\r\n');
    expect(ast.variables).toHaveLength(2);
    expect(ast.variables[1]?.value).toBe('2');
  });

  it('reports whether the file ends with a newline', () => {
    expect(parseEnv('A=1\n').endsWithNewline).toBe(true);
    expect(parseEnv('A=1').endsWithNewline).toBe(false);
    expect(parseEnv('A=1').variables).toHaveLength(1);
  });

  it('records value ranges usable for surgical edits', () => {
    const ast = parseEnv('KEY="secret"\n');
    const range = ast.variables[0]?.valueRange;
    expect(range).toEqual({ startLine: 0, startColumn: 4, endLine: 0, endColumn: 12 });
  });

  it('falls back gracefully on an unterminated quote', () => {
    const ast = parseEnv('BROKEN="never closed\nNEXT=1\n');
    expect(ast.variables[0]?.key).toBe('BROKEN');
    expect(ast.variables).toHaveLength(2);
  });

  it('builds the effective environment record, last one winning', () => {
    const record = toRecord(parseEnv('A=1\nB=2\nA=3\n'));
    expect(record).toEqual({ A: '3', B: '2' });
  });

  it('parses the specification example end to end', () => {
    const source = [
      'DISCORD_TOKEN=eyJhbGciOiJIUzI1NiIs',
      'DATABASE_URL=postgresql://user:password@localhost/mydb',
      'API_KEY=sk-proj-xxxxxxxxxxxxxxxx',
      'PASSWORD=super-secret-password',
      'PORT=3000',
      'NODE_ENV=development',
      '',
    ].join('\n');
    const ast = parseEnv(source);
    expect(ast.variables.map((variable) => variable.key)).toEqual([
      'DISCORD_TOKEN',
      'DATABASE_URL',
      'API_KEY',
      'PASSWORD',
      'PORT',
      'NODE_ENV',
    ]);
  });
});
