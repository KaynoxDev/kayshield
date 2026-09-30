/**
 * Masking.
 *
 * The engine is deliberately dumb and deliberately lossy: it produces a string
 * that carries no information about the value it replaces. By default the mask
 * has a fixed width, because the length of a secret is itself a hint that
 * narrows an attacker's search space and often identifies the provider.
 *
 * Pure module: no `vscode` import.
 */

export interface MaskingOptions {
  /** Character repeated to build the mask. */
  readonly maskCharacter: string;
  /** When true, the mask has the same length as the value. Off by default. */
  readonly preserveLength: boolean;
}

export const DEFAULT_MASKING_OPTIONS: MaskingOptions = {
  maskCharacter: '•',
  preserveLength: false,
};

/** Fixed mask width used when the value length must not leak. */
const FIXED_WIDTH = 12;
/** Upper bound when preserving length, so a PEM block cannot flood the view. */
const MAX_WIDTH = 48;

export class MaskingEngine {
  private options: MaskingOptions;

  constructor(options: Partial<MaskingOptions> = {}) {
    this.options = { ...DEFAULT_MASKING_OPTIONS, ...options };
  }

  update(options: Partial<MaskingOptions>): void {
    this.options = { ...this.options, ...options };
  }

  get maskCharacter(): string {
    return this.options.maskCharacter;
  }

  /**
   * Returns the masked representation of a value.
   * An empty value masks to an empty string: there is nothing to hide, and a
   * fake mask would wrongly suggest a secret is present.
   */
  mask(value: string): string {
    if (value.length === 0) {
      return '';
    }
    const character = normalizeMaskCharacter(this.options.maskCharacter);
    const width = this.options.preserveLength
      ? Math.min(Math.max(value.length, 1), MAX_WIDTH)
      : FIXED_WIDTH;
    return character.repeat(width);
  }

  /** Chooses between the real value and the mask. */
  display(value: string, masked: boolean): string {
    return masked ? this.mask(value) : value;
  }
}

/** Guards against multi-character or empty configuration values. */
export function normalizeMaskCharacter(input: string): string {
  const characters = [...input];
  const first = characters[0];
  if (first === undefined || first.trim().length === 0) {
    return DEFAULT_MASKING_OPTIONS.maskCharacter;
  }
  return first;
}
