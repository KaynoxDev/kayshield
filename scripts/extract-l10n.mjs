/**
 * Extracts every `vscode.l10n.t('...')` literal from `src/` and reports the ones
 * missing from a translation bundle.
 *
 * Usage:
 *   node scripts/extract-l10n.mjs            # list all strings
 *   node scripts/extract-l10n.mjs --check fr # fail if the fr bundle is stale
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(directory) {
  const results = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walk(full));
    } else if (full.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

const PATTERN = /l10n\.t\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g;

const strings = new Set();
for (const file of walk(join(root, 'src'))) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(PATTERN)) {
    strings.add(match[2].replace(/\\'/g, "'").replace(/\\"/g, '"'));
  }
}

const sorted = [...strings].sort();
const checkIndex = process.argv.indexOf('--check');

if (checkIndex === -1) {
  process.stdout.write(
    `${JSON.stringify(Object.fromEntries(sorted.map((s) => [s, s])), null, 2)}\n`,
  );
  process.exit(0);
}

const locale = process.argv[checkIndex + 1] ?? 'fr';
const bundlePath = join(root, 'l10n', `bundle.l10n.${locale}.json`);
if (!existsSync(bundlePath)) {
  process.stderr.write(`missing bundle: ${bundlePath}\n`);
  process.exit(1);
}

const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
const missing = sorted.filter((key) => !(key in bundle));
const extra = Object.keys(bundle).filter((key) => !strings.has(key));

for (const key of missing) {
  process.stderr.write(`missing translation: ${key}\n`);
}
for (const key of extra) {
  process.stderr.write(`obsolete translation: ${key}\n`);
}
process.stdout.write(
  `${sorted.length} strings, ${missing.length} missing, ${extra.length} obsolete\n`,
);
process.exit(missing.length + extra.length === 0 ? 0 : 1);
