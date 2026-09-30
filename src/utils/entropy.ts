/** Shannon entropy helpers used by the heuristic secret detectors. Pure module. */

/** Shannon entropy in bits per character. Returns 0 for empty input. */
export function shannonEntropy(input: string): number {
  if (input.length === 0) {
    return 0;
  }
  const frequencies = new Map<string, number>();
  for (const char of input) {
    frequencies.set(char, (frequencies.get(char) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of frequencies.values()) {
    const probability = count / input.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

export interface CharacterClasses {
  readonly lower: boolean;
  readonly upper: boolean;
  readonly digit: boolean;
  readonly symbol: boolean;
  /** Number of distinct classes present. */
  readonly count: number;
}

export function characterClasses(input: string): CharacterClasses {
  const lower = /[a-z]/.test(input);
  const upper = /[A-Z]/.test(input);
  const digit = /[0-9]/.test(input);
  const symbol = /[^A-Za-z0-9]/.test(input);
  return {
    lower,
    upper,
    digit,
    symbol,
    count: [lower, upper, digit, symbol].filter(Boolean).length,
  };
}

/** Ratio of distinct characters to total length: low values mean repetition. */
export function uniqueRatio(input: string): number {
  if (input.length === 0) {
    return 0;
  }
  return new Set(input).size / input.length;
}
