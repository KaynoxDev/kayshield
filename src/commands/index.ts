/** Single registration point for every EnvShield command. */

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
    'envshield.openEnvironmentFile': openEnvironmentFile(context),
    'envshield.openAsPlainText': openAsPlainText(),
    'envshield.hideAllSecrets': hideAllSecrets(context),
    'envshield.revealAllSecrets': revealAllSecrets(context),
    'envshield.toggleStreamerMode': toggleStreamerMode(context),
    'envshield.scanWorkspace': scanWorkspace(context),
    'envshield.configure': configure(context),
    'envshield.revealVariable': revealVariable(context),
    'envshield.hideVariable': hideVariable(context),
    'envshield.copyVariableValue': copyVariableValue(),
    'envshield.refresh': () => context.tree.reload(),
    'envshield.setDefaultEditor': setDefaultEditor(),
    'envshield.clearDefaultEditor': clearDefaultEditor(),
    'envshield.showWelcome': () => WelcomePanel.show(context.extensionContext),
    'envshield.alwaysMaskVariable': alwaysMaskVariable(context),
    'envshield.neverMaskVariable': neverMaskVariable(context),
  };

  return Object.entries(commands).map(([id, handler]) =>
    vscode.commands.registerCommand(id, handler),
  );
}
