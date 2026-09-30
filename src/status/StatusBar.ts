/**
 * Status bar indicator.
 *
 * Three states, deliberately unmistakable at a glance on a stream overlay:
 *  - protection engaged  -> "Stream Safe" with the warning background,
 *  - values revealed     -> a count, so nothing is visible without you knowing,
 *  - idle                -> "EnvShield".
 */

import * as vscode from 'vscode';
import type { Configuration } from '../config/Configuration';
import type { RevealRegistry } from '../security/RevealRegistry';
import type { ScreenProtection } from '../streamer/ScreenProtection';
import type { StreamerMode } from '../streamer/StreamerMode';

export interface StatusBarDependencies {
  readonly configuration: Configuration;
  readonly reveals: RevealRegistry;
  readonly protection: ScreenProtection;
  readonly streamerMode: StreamerMode;
}

export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly deps: StatusBarDependencies) {
    this.item = vscode.window.createStatusBarItem(
      'envshield.status',
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.name = 'EnvShield';
    this.item.command = 'envshield.configure';

    this.disposables.push(
      this.item,
      deps.protection.onDidChange(() => this.update()),
      deps.reveals.onDidChange(() => this.update()),
      deps.configuration.onDidChange(() => this.update()),
    );

    this.update();
  }

  update(): void {
    const settings = this.deps.configuration.settings;
    if (!settings.showStatusBar || !settings.enabled) {
      this.item.hide();
      return;
    }

    const engaged = this.deps.streamerMode.enabled || this.deps.protection.isEngaged;
    const revealed = this.deps.reveals.revealedCount;

    if (engaged) {
      this.item.text = `$(broadcast) ${vscode.l10n.t('Stream Safe')}`;
      this.item.tooltip = vscode.l10n.t(
        'Streamer Mode is on: EnvShield keeps every sensitive value masked. Click for actions.',
      );
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else if (revealed > 0) {
      this.item.text = `$(eye) ${vscode.l10n.t('{0} revealed', revealed)}`;
      this.item.tooltip = vscode.l10n.t(
        '{0} values are currently visible. Click for actions.',
        revealed,
      );
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.item.text = `$(shield) ${vscode.l10n.t('Protected')}`;
      this.item.tooltip = vscode.l10n.t('EnvShield is watching your environment files.');
      this.item.backgroundColor = undefined;
    }

    this.item.show();
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}
