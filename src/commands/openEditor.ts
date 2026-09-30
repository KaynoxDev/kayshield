/**
 * Opening files, both ways.
 *
 * KayShield never takes an editor hostage: "Open as Plain Text" is one command
 * away, and the custom editor is contributed with `priority: "option"` so the
 * default association is unchanged until the user asks for it.
 */

import * as vscode from 'vscode';
import { ENV_EDITOR_VIEW_TYPE } from '../editor/EnvEditorProvider';
import { classifyEnvFile } from '../env/EnvFileDetector';
import { EnvFileItem } from '../views/EnvironmentTreeItem';
import type { CommandContext } from './types';

const DEFAULT_ASSOCIATIONS: readonly string[] = ['**/.env', '**/.env.*', '**/*.env'];

function resolveUri(target: unknown): vscode.Uri | undefined {
  if (target instanceof vscode.Uri) {
    return target;
  }
  if (target instanceof EnvFileItem) {
    return target.uri;
  }
  if (
    typeof target === 'object' &&
    target !== null &&
    'uri' in target &&
    (target as { uri: unknown }).uri instanceof vscode.Uri
  ) {
    return (target as { uri: vscode.Uri }).uri;
  }
  return activeTabUri();
}

function activeTabUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input && typeof input === 'object' && 'uri' in input) {
    const uri = (input as { uri: unknown }).uri;
    if (uri instanceof vscode.Uri) {
      return uri;
    }
  }
  return vscode.window.activeTextEditor?.document.uri;
}

/** Opens a file in the KayShield editor, picking one if none is given. */
export function openEnvironmentFile(context: CommandContext) {
  return async (target?: unknown): Promise<void> => {
    const uri = resolveUri(target) ?? (await pickEnvironmentFile(context));
    if (!uri) {
      return;
    }
    await vscode.commands.executeCommand('vscode.openWith', uri, ENV_EDITOR_VIEW_TYPE);
  };
}

/** Opens the same file in the plain text editor. */
export function openAsPlainText() {
  return async (target?: unknown): Promise<void> => {
    const uri = resolveUri(target);
    if (!uri) {
      return;
    }
    await vscode.commands.executeCommand('vscode.openWith', uri, 'default');
  };
}

async function pickEnvironmentFile(context: CommandContext): Promise<vscode.Uri | undefined> {
  const patterns = context.configuration.settings.filePatterns;
  const found = await vscode.workspace.findFiles(
    '**/{.env*,*.env}',
    '**/{node_modules,.git,dist,out}/**',
    100,
  );
  const candidates = found.filter(
    (uri) => classifyEnvFile(uri.path, { filePatterns: patterns }).isEnvFile,
  );

  if (candidates.length === 0) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('No environment file found in this workspace.'),
    );
    return undefined;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }

  const picked = await vscode.window.showQuickPick(
    candidates.map((uri) => ({
      label: vscode.workspace.asRelativePath(uri, false),
      uri,
    })),
    { placeHolder: vscode.l10n.t('Select an environment file') },
  );
  return picked?.uri;
}

/** Makes KayShield the default editor for `.env` files. */
export function setDefaultEditor() {
  return async (): Promise<void> => {
    const config = vscode.workspace.getConfiguration('workbench');
    const current = config.get<Record<string, string>>('editorAssociations', {});
    const updated = { ...current };
    for (const pattern of DEFAULT_ASSOCIATIONS) {
      updated[pattern] = ENV_EDITOR_VIEW_TYPE;
    }
    await config.update('editorAssociations', updated, vscode.ConfigurationTarget.Global);
    await vscode.window.showInformationMessage(
      vscode.l10n.t('KayShield is now the default editor for .env files.'),
    );
  };
}

/** Restores the default text editor association. */
export function clearDefaultEditor() {
  return async (): Promise<void> => {
    const config = vscode.workspace.getConfiguration('workbench');
    const current = config.get<Record<string, string>>('editorAssociations', {});
    const updated: Record<string, string> = {};
    for (const [pattern, viewType] of Object.entries(current)) {
      if (viewType !== ENV_EDITOR_VIEW_TYPE) {
        updated[pattern] = viewType;
      }
    }
    await config.update('editorAssociations', updated, vscode.ConfigurationTarget.Global);
    await vscode.window.showInformationMessage(
      vscode.l10n.t('.env files open in the text editor again.'),
    );
  };
}
