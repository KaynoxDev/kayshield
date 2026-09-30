/**
 * The EnvShield menu.
 *
 * Reachable from the status bar and from `EnvShield: Configure`. A quick pick
 * rather than a settings webview: it is native, keyboard-first, screen-reader
 * friendly and costs nothing to render.
 */

import * as vscode from 'vscode';
import { CONFIG_SECTION } from '../config/Configuration';
import { logger } from '../utils/Logger';
import type { CommandContext } from './types';

interface MenuItem extends vscode.QuickPickItem {
  readonly run: () => Thenable<unknown>;
}

export function configure(context: CommandContext) {
  return async (): Promise<void> => {
    const engaged = context.streamerMode.enabled;
    const revealed = context.reveals.revealedCount;

    const items: MenuItem[] = [
      {
        label: engaged
          ? '$(shield) ' + vscode.l10n.t('Turn Streamer Mode off')
          : '$(broadcast) ' + vscode.l10n.t('Turn Streamer Mode on'),
        description: engaged
          ? vscode.l10n.t('Values can be revealed again')
          : vscode.l10n.t('Keep every sensitive value masked'),
        run: () => vscode.commands.executeCommand('envshield.toggleStreamerMode'),
      },
      {
        label: '$(eye-closed) ' + vscode.l10n.t('Hide all secrets'),
        description:
          revealed > 0
            ? vscode.l10n.t('{0} values are visible right now', revealed)
            : vscode.l10n.t('Nothing is visible'),
        run: () => vscode.commands.executeCommand('envshield.hideAllSecrets'),
      },
      {
        label: '$(shield) ' + vscode.l10n.t('Open environment file'),
        run: () => vscode.commands.executeCommand('envshield.openEnvironmentFile'),
      },
      {
        label: '$(search) ' + vscode.l10n.t('Scan workspace'),
        run: () => vscode.commands.executeCommand('envshield.scanWorkspace'),
      },
      {
        label: '$(gear) ' + vscode.l10n.t('Open EnvShield settings'),
        // Derived, never hardcoded: the identifier changes with the publisher,
        // and a stale literal here silently opens an empty settings page.
        run: () =>
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            `@ext:${context.extensionContext.extension.id}`,
          ),
      },
      {
        label: '$(file-code) ' + vscode.l10n.t('Use EnvShield as the default .env editor'),
        run: () => vscode.commands.executeCommand('envshield.setDefaultEditor'),
      },
      {
        label: '$(info) ' + vscode.l10n.t('About EnvShield'),
        run: () => vscode.commands.executeCommand('envshield.showWelcome'),
      },
      {
        label: '$(output) ' + vscode.l10n.t('Show logs'),
        description: vscode.l10n.t('Values are always redacted'),
        run: async () => {
          logger.show();
        },
      },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: 'EnvShield',
      placeHolder: vscode.l10n.t('Choose an action'),
      matchOnDescription: true,
    });
    await picked?.run();
  };
}

/** Opens the settings UI filtered on one EnvShield setting. */
export function openSetting(key: string): Thenable<unknown> {
  return vscode.commands.executeCommand(
    'workbench.action.openSettings',
    `${CONFIG_SECTION}.${key}`,
  );
}
