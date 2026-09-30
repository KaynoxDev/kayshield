/**
 * Reveal one variable, from the tree view.
 *
 * Every reveal in the extension funnels through here or through the editor's
 * `reveal` message, and both refuse while protection is engaged. There is no
 * third path.
 */

import * as vscode from 'vscode';
import { EnvVariableItem } from '../views/EnvironmentTreeItem';
import type { CommandContext } from './types';

export function revealVariable(context: CommandContext) {
  return async (item?: EnvVariableItem): Promise<void> => {
    if (!(item instanceof EnvVariableItem)) {
      return;
    }
    if (context.streamerMode.enabled || context.protection.isEngaged) {
      await vscode.window.showWarningMessage(
        vscode.l10n.t('Streamer Mode is on. Turn it off to reveal a value.'),
      );
      return;
    }
    context.reveals.reveal(
      item.uri,
      item.variable.id,
      context.configuration.settings.revealTimeout,
    );
  };
}
