/**
 * The panic button.
 *
 * Bound to Ctrl+Shift+Alt+H and available from the view title bar, the command
 * palette and the editor footer. It must be the fastest thing in the extension:
 * cancel every timer, drop every reveal, tell every surface to re-mask, and
 * only then offer to go further.
 *
 * It deliberately does not turn Streamer Mode on by itself. Silently changing a
 * persisted mode would leave the user wondering why reveal stopped working; the
 * offer is made instead, as a follow-up notification.
 */

import * as vscode from 'vscode';
import { logger } from '../utils/Logger';
import type { CommandContext } from './types';

export function hideAllSecrets(context: CommandContext) {
  return async (options?: { silent?: boolean }): Promise<void> => {
    // Order matters: clear state first, then force every surface to repaint.
    context.reveals.hideAll();
    context.protection.enforce();
    context.tree.refresh();
    logger.info('Panic: every revealed value has been hidden');

    if (options?.silent === true || context.streamerMode.enabled) {
      return;
    }

    const enable = vscode.l10n.t('Enable Streamer Mode');
    const choice = await vscode.window.showInformationMessage(
      vscode.l10n.t('All values are hidden.'),
      enable,
    );
    if (choice === enable) {
      await context.streamerMode.setEnabled(true);
    }
  };
}
