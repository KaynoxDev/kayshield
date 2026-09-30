/** Single registration point for every KayShield command. */

import * as vscode from 'vscode';
import { WelcomePanel } from '../welcome/WelcomePanel';
import { configure } from './configure';
import { hideAllSecrets } from './hideAll';
import { hideVariable } from './hideVariable';
import {
  clearDefaultEditor,
  openAsPlainText,
  openEnvironmentFile,
  setDefaultEditor,
} from './openEditor';
import { revealAllSecrets } from './revealAll';
import { revealVariable } from './revealVariable';
import { alwaysMaskVariable, copyVariableValue, neverMaskVariable } from './rules';
import { scanWorkspace } from './scanSecrets';
import { toggleStreamerMode } from './toggleStreamerMode';
import type { CommandContext } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CommandHandler = (...args: any[]) => unknown;

export function registerCommands(context: CommandContext): vscode.Disposable[] {
  const commands: Record<string, CommandHandler> = {
    'kayshield.openEnvironmentFile': openEnvironmentFile(context),
    'kayshield.openAsPlainText': openAsPlainText(),
    'kayshield.hideAllSecrets': hideAllSecrets(context),
    'kayshield.revealAllSecrets': revealAllSecrets(context),
    'kayshield.toggleStreamerMode': toggleStreamerMode(context),
    'kayshield.scanWorkspace': scanWorkspace(context),
    'kayshield.configure': configure(context),
    'kayshield.revealVariable': revealVariable(context),
    'kayshield.hideVariable': hideVariable(context),
    'kayshield.copyVariableValue': copyVariableValue(),
    'kayshield.refresh': () => context.tree.reload(),
    'kayshield.setDefaultEditor': setDefaultEditor(),
    'kayshield.clearDefaultEditor': clearDefaultEditor(),
    'kayshield.showWelcome': () => WelcomePanel.show(context.extensionContext),
    'kayshield.alwaysMaskVariable': alwaysMaskVariable(context),
    'kayshield.neverMaskVariable': neverMaskVariable(context),
  };

  return Object.entries(commands).map(([id, handler]) =>
    vscode.commands.registerCommand(id, handler),
  );
}
