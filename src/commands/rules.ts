/**
 * Per-variable rules and clipboard access, from the tree view context menu.
 */

import * as vscode from 'vscode';
import { Configuration } from '../config/Configuration';
import { EnvVariableItem } from '../views/EnvironmentTreeItem';
import type { CommandContext } from './types';

function keyOf(item: unknown): string | undefined {
  return item instanceof EnvVariableItem ? item.variable.key : undefined;
}

export function alwaysMaskVariable(context: CommandContext) {
  return async (item?: unknown): Promise<void> => {
    const key = keyOf(item);
    if (!key) {
      return;
    }
    await Configuration.addToList('alwaysMask', key);
    context.tree.refresh();
    await vscode.window.showInformationMessage(vscode.l10n.t('{0} will always be masked.', key));
  };
}

export function neverMaskVariable(context: CommandContext) {
  return async (item?: unknown): Promise<void> => {
    const key = keyOf(item);
    if (!key) {
      return;
    }
    const confirm = vscode.l10n.t('Never mask it');
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        '{0} will be shown in clear text everywhere in EnvShield, including on a stream.',
        key,
      ),
      { modal: true },
      confirm,
    );
    if (choice !== confirm) {
      return;
    }
    await Configuration.addToList('neverMask', key);
    context.tree.refresh();
  };
}

/**
 * Copies a value to the clipboard.
 *
 * Allowed even in Streamer Mode: the clipboard is not the screen, and refusing
 * would only push the user towards opening the file as plain text, which is
 * strictly worse.
 */
export function copyVariableValue() {
  return async (item?: unknown): Promise<void> => {
    if (!(item instanceof EnvVariableItem)) {
      return;
    }
    await vscode.env.clipboard.writeText(item.variable.value);
    await vscode.window.setStatusBarMessage(
      vscode.l10n.t('$(clippy) Value of {0} copied', item.variable.key),
      3000,
    );
  };
}
