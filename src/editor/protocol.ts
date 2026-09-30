/**
 * The extension-host <-> webview contract.
 *
 * SECURITY: exactly one message type may carry a plaintext value, and it only
 * ever carries one at a time: {@link HostValueMessage}. It is sent solely in
 * response to an explicit user reveal that Streamer Mode did not veto. Every
 * other payload is masked before it leaves the host.
 */

import type { MaskedVariable } from '../types';

/** State the webview needs in order to render controls correctly. */
export interface WebviewState {
  readonly fileName: string;
  readonly streamerMode: boolean;
  readonly revealTimeout: number;
  readonly isTemplate: boolean;
  readonly secretCount: number;
  readonly totalCount: number;
  readonly readOnly: boolean;
}

export interface HostInitMessage {
  readonly type: 'init';
  readonly variables: readonly MaskedVariable[];
  readonly state: WebviewState;
  readonly strings: Record<string, string>;
}

export interface HostUpdateMessage {
  readonly type: 'update';
  readonly variables: readonly MaskedVariable[];
  readonly state: WebviewState;
}

/** The single plaintext channel. One variable, one reveal, one message. */
export interface HostValueMessage {
  readonly type: 'value';
  readonly id: string;
  readonly value: string;
  /** Milliseconds until the host re-masks it, or 0 for no timeout. */
  readonly timeout: number;
}

/** Instructs the webview to drop a plaintext value it currently holds. */
export interface HostMaskMessage {
  readonly type: 'mask';
  /** Undefined means "every value in this document". */
  readonly id?: string;
}

export interface HostToastMessage {
  readonly type: 'toast';
  readonly text: string;
  readonly tone: 'info' | 'warning';
}

export type HostMessage =
  HostInitMessage | HostUpdateMessage | HostValueMessage | HostMaskMessage | HostToastMessage;

export type WebviewMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'reveal'; readonly id: string }
  | { readonly type: 'hide'; readonly id: string }
  | { readonly type: 'hideAll' }
  | { readonly type: 'revealAll' }
  | { readonly type: 'toggleStreamerMode' }
  | { readonly type: 'copy'; readonly id: string }
  | { readonly type: 'edit'; readonly id: string; readonly value: string }
  | { readonly type: 'rename'; readonly id: string; readonly key: string }
  | { readonly type: 'delete'; readonly id: string }
  | { readonly type: 'add'; readonly key: string; readonly value: string }
  | { readonly type: 'openAsText' };

/** Narrowing guard for untrusted input coming from the webview. */
export function isWebviewMessage(value: unknown): value is WebviewMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}
