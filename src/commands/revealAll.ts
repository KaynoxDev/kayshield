/**
 * Reveal every secret of the active environment file.
 *
 * Scoped to one document on purpose: a workspace-wide reveal is a footgun with
 * no legitimate use, and the timeout would fire on files the user never looked
 * at. Refused outright while protection is engaged.
 */

import * as vscode from 'vscode';
import { classifyEnvFile } from '../env/EnvFileDetector';
import { parseEnv } from '../env/EnvParser';
import { buildVariables } from '../env/EnvVariable';
import { createAnalyzer } from '../security/SecretDetector';
import type { CommandContext } from './types';

export function revealAllSecrets(context: CommandContext) {
  return async (target?: vscode.Uri): Promise<void> => {
    if (context.streamerMode.enabled || context.protection.isEngaged) {
      await vscode.window.showWarningMessage(
        vscode.l10n.t('Streamer Mode is on. Turn it off to reveal values.'),
      );
      return;
    }

    const uri = target ?? vscode.window.activeTextEditor?.document.uri;
    if (!uri) {
      await vscode.window.showInformationMessage(vscode.l10n.t('Open an environment file first.'));
      return;
    }

    const settings = context.configuration.settings;
    const classification = classifyEnvFile(uri.path, {
      filePatterns: settings.filePatterns,
      protectEnvExample: settings.protectEnvExample,
    });
    if (!classification.isEnvFile) {
      await vscode.window.showInformationMessage(
        vscode.l10n.t('{0} is not an environment file.', classification.fileName),
      );
      return;
    }

    const document = await vscode.workspace.openTextDocument(uri);
    const variables = buildVariables(parseEnv(document.getText()), {
      analyzer: createAnalyzer(settings.secretPatterns),
      rules: context.configuration.rulesFor(classification.treatAsPublic),
      revealed: new Set<string>(),
      forceMask: false,
    });

    for (const variable of variables) {
      if (variable.secret) {
        context.reveals.reveal(uri, variable.id, settings.revealTimeout);
      }
    }
  };
}
