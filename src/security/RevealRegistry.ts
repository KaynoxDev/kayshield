/**
 * Session-scoped reveal state.
 *
 * One registry for the whole extension, so the editor, the tree view and the
 * panic command can never disagree about what is currently visible. Reveals are
 * keyed by document URI and variable id, and each one owns a timer.
 *
 * Nothing here is persisted. Reloading the window, closing the tab or letting
 * the timer expire all return to the masked state.
 */

import * as vscode from 'vscode';

export interface RevealChange {
  readonly uri: string;
  readonly variableId: string | undefined;
  readonly revealed: boolean;
}

interface RevealEntry {
  timer: ReturnType<typeof setTimeout> | undefined;
}

export class RevealRegistry implements vscode.Disposable {
  private readonly documents = new Map<string, Map<string, RevealEntry>>();
  private readonly emitter = new vscode.EventEmitter<RevealChange>();

  readonly onDidChange = this.emitter.event;

  /** Ids currently revealed for a document. Never mutate the result. */
  revealedIds(uri: vscode.Uri): ReadonlySet<string> {
    const entries = this.documents.get(uri.toString());
    return entries ? new Set(entries.keys()) : EMPTY;
  }

  isRevealed(uri: vscode.Uri, variableId: string): boolean {
    return this.documents.get(uri.toString())?.has(variableId) ?? false;
  }

  /**
   * Reveals a variable for `timeoutMs`. A timeout of 0 keeps it revealed until
   * it is hidden explicitly, by the panic command or by Streamer Mode.
   */
  reveal(uri: vscode.Uri, variableId: string, timeoutMs: number): void {
    const key = uri.toString();
    let entries = this.documents.get(key);
    if (!entries) {
      entries = new Map();
      this.documents.set(key, entries);
    }

    const existing = entries.get(variableId);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }

    const entry: RevealEntry = { timer: undefined };
    if (timeoutMs > 0) {
      entry.timer = setTimeout(() => {
        this.hide(uri, variableId);
      }, timeoutMs);
    }
    entries.set(variableId, entry);
    this.emitter.fire({ uri: key, variableId, revealed: true });
  }

  hide(uri: vscode.Uri, variableId: string): void {
    const key = uri.toString();
    const entries = this.documents.get(key);
    const entry = entries?.get(variableId);
    if (!entries || !entry) {
      return;
    }
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    entries.delete(variableId);
    if (entries.size === 0) {
      this.documents.delete(key);
    }
    this.emitter.fire({ uri: key, variableId, revealed: false });
  }

  /** Hides every variable of one document and cancels its timers. */
  hideDocument(uri: vscode.Uri): void {
    const key = uri.toString();
    const entries = this.documents.get(key);
    if (!entries) {
      return;
    }
    for (const entry of entries.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
      }
    }
    this.documents.delete(key);
    this.emitter.fire({ uri: key, variableId: undefined, revealed: false });
  }

  /**
   * The panic path: cancels every timer and clears every reveal, everywhere.
   * Must remain synchronous and allocation free enough to be instantaneous.
   */
  hideAll(): void {
    const keys = [...this.documents.keys()];
    for (const entries of this.documents.values()) {
      for (const entry of entries.values()) {
        if (entry.timer) {
          clearTimeout(entry.timer);
        }
      }
    }
    this.documents.clear();
    for (const key of keys) {
      this.emitter.fire({ uri: key, variableId: undefined, revealed: false });
    }
  }

  /** Number of values currently visible, across all documents. */
  get revealedCount(): number {
    let total = 0;
    for (const entries of this.documents.values()) {
      total += entries.size;
    }
    return total;
  }

  dispose(): void {
    this.hideAll();
    this.emitter.dispose();
  }
}

const EMPTY: ReadonlySet<string> = new Set<string>();
