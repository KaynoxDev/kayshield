/**
 * Streamer Mode.
 *
 * A single switch that engages Screen Safe, persists across reloads and exposes
 * a `when` clause context key so contributed UI can react without polling.
 *
 * While Streamer Mode is on, reveal is not merely discouraged - it is refused
 * at the source, in the editor provider and in the tree provider. There is no
 * code path that can send a plaintext value to a webview in this state.
 */

import * as vscode from 'vscode';
import { Configuration } from '../config/Configuration';
import { logger } from '../utils/Logger';
import type { ScreenProtection } from './ScreenProtection';

export const STREAMER_MODE_CONTEXT_KEY = 'kayshield.streamerMode';

export class StreamerMode implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private enabledState: boolean;

  constructor(
    configuration: Configuration,
    private readonly protection: ScreenProtection,
  ) {
    this.enabledState = configuration.settings.streamerMode;
    void this.syncContextKey();
    if (this.enabledState) {
      this.protection.setEngaged(true);
    }

    this.disposables.push(
      configuration.onDidChange((settings) => {
        if (settings.streamerMode !== this.enabledState) {
          this.applyState(settings.streamerMode);
        }
      }),
    );
  }

  get enabled(): boolean {
    return this.enabledState;
  }

  async toggle(): Promise<boolean> {
    await this.setEnabled(!this.enabledState);
    return this.enabledState;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (this.enabledState === enabled) {
      return;
    }
    this.applyState(enabled);
    await this.persist(enabled);
  }

  /** Applies the new state in memory and to every protected surface. */
  private applyState(enabled: boolean): void {
    this.enabledState = enabled;
    this.protection.setEngaged(enabled);
    void this.syncContextKey();
    logger.info(`Streamer Mode ${enabled ? 'enabled' : 'disabled'}`);
  }

  private async persist(enabled: boolean): Promise<void> {
    try {
      await Configuration.update('streamerMode', enabled);
    } catch (error) {
      // Persistence is a convenience; protection is already applied in memory.
      logger.warn('Could not persist Streamer Mode state', error);
    }
  }

  private async syncContextKey(): Promise<void> {
    await vscode.commands.executeCommand(
      'setContext',
      STREAMER_MODE_CONTEXT_KEY,
      this.enabledState,
    );
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}
