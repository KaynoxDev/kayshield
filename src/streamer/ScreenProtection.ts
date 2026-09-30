/**
 * Screen Safe: the umbrella protection state.
 *
 * `ScreenProtection` owns one boolean and a registry of providers. Providers
 * are the extension points that will let Screen Safe grow beyond `.env` files
 * (JSON, YAML, Git diffs...) without any of them knowing about each other.
 *
 * HONEST LIMITS - documented in the README and surfaced in the UI:
 * VS Code offers no API to mask the integrated terminal buffer, the debug
 * console, another extension's webview or an output channel written by someone
 * else. Screen Safe therefore protects what EnvShield renders, and nothing
 * else. We never claim otherwise.
 */

import * as vscode from 'vscode';

export interface ProtectionProvider {
  readonly id: string;
  /**
   * Must synchronously bring the surface to a safe state: every secret masked,
   * every pending reveal cancelled.
   */
  engage(): void;
  /** Called when protection is lifted. Must not reveal anything by itself. */
  disengage(): void;
}

export class ScreenProtection implements vscode.Disposable {
  private readonly providers = new Map<string, ProtectionProvider>();
  private readonly emitter = new vscode.EventEmitter<boolean>();
  private engagedState = false;

  readonly onDidChange = this.emitter.event;

  get isEngaged(): boolean {
    return this.engagedState;
  }

  /** Registers a surface. The provider is engaged immediately if needed. */
  register(provider: ProtectionProvider): vscode.Disposable {
    this.providers.set(provider.id, provider);
    if (this.engagedState) {
      provider.engage();
    }
    return new vscode.Disposable(() => {
      this.providers.delete(provider.id);
    });
  }

  setEngaged(engaged: boolean): void {
    if (this.engagedState === engaged) {
      // Still re-apply: a redundant "hide everything" is always safe.
      if (engaged) {
        this.applyEngage();
      }
      return;
    }
    this.engagedState = engaged;
    if (engaged) {
      this.applyEngage();
    } else {
      for (const provider of this.providers.values()) {
        provider.disengage();
      }
    }
    this.emitter.fire(engaged);
  }

  /**
   * Panic path. Tells every surface to re-mask right now, without changing the
   * engaged state: hiding everything must not silently turn Streamer Mode on,
   * because the user would then have no obvious way to turn it back off.
   */
  enforce(): void {
    this.applyEngage();
  }

  private applyEngage(): void {
    for (const provider of this.providers.values()) {
      provider.engage();
    }
  }

  dispose(): void {
    this.providers.clear();
    this.emitter.dispose();
  }
}
