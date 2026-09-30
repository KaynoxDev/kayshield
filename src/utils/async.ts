/** Small scheduling helpers. Pure module. */

export interface Debounced<TArgs extends unknown[]> {
  (...args: TArgs): void;
  /** Cancels a pending invocation. Always call this on dispose. */
  cancel(): void;
}

/**
 * Trailing-edge debounce. Used to keep parsing off the hot path when a document
 * changes character by character.
 */
export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delayMs: number,
): Debounced<TArgs> {
  let handle: ReturnType<typeof setTimeout> | undefined;

  const debounced = ((...args: TArgs): void => {
    if (handle !== undefined) {
      clearTimeout(handle);
    }
    handle = setTimeout(() => {
      handle = undefined;
      fn(...args);
    }, delayMs);
  }) as Debounced<TArgs>;

  debounced.cancel = (): void => {
    if (handle !== undefined) {
      clearTimeout(handle);
      handle = undefined;
    }
  };

  return debounced;
}
