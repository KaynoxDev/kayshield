/** Toggle Streamer Mode, and say so unmistakably. */

import * as vscode from 'vscode';
import type { CommandContext } from './types';

export function toggleStreamerMode(context: CommandContext) {
  return async (): Promise<void> => {
    const enabled = await context.streamerMode.toggle();
    if (enabled) {
      // Reveals are dropped by the protection providers; this is belt and braces.
      context.reveals.hideAll();
    }
    context.tree.refresh();

    await vscode.window.setStatusBarMessage(
      enabled
        ? vscode.l10n.t('$(broadcast) Streamer Mode ON - sensitive values stay masked')
        : vscode.l10n.t('$(shield) Streamer Mode OFF'),
      4000,
    );
  };
}
