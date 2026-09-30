/**
 * Minimal, dependency-free glob matching for variable names and file names.
 *
 * Supports `*` (any run of characters) and `?` (single character). Matching is
 * case-insensitive because environment variable names are conventionally
 * uppercase but users write rules in any case.
 */

const cache = new Map<string, RegExp>();

function toRegExp(pattern: string): RegExp {
  const cached = cache.get(pattern);
  if (cached) {
    return cached;
  }
  let source = '^';
  for (const char of pattern) {
    if (char === '*') {
      source += '.*';
    } else if (char === '?') {
      source += '.';
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  source += '$';
  const regex = new RegExp(source, 'i');
  // Bounded cache: user rule sets are small, this only guards against abuse.
  if (cache.size > 500) {
    cache.clear();
  }
  cache.set(pattern, regex);
  return regex;
}

/** True when `value` matches the glob `pattern`. */
export function matchesGlob(value: string, pattern: string): boolean {
  return toRegExp(pattern).test(value);
}

/** True when `value` matches at least one of the glob patterns. */
export function matchesAnyGlob(value: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesGlob(value, pattern));
}
