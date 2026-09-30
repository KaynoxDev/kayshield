/**
 * EnvShield activation.
 *
 * Activation is intentionally cheap: build the state objects, register the
 * providers, and stop. No file is read, no directory is walked and no parsing
 * happens until something is actually shown - the tree only reads a file when
 * its node is expanded, the editor only when a document is opened.
 *
 * Everything created here is pushed into `context.subscriptions`, so a window
 * reload or a disable leaves no timer, no watcher and no listener behind.
 */

import * as vscode from 'vscode';
import { registerCommands } from './commands';
import type { CommandContext } from './commands/types';
import { Configuration } from './config/Configuration';
import { SecretStore } from './config/SecretStore';
import { EnvEditorProvider } from './editor/EnvEditorProvider';
import { WorkspaceScanner } from './scan/WorkspaceScanner';
import { RevealRegistry } from './security/RevealRegistry';
import { ScreenProtection } from './streamer/ScreenProtection';
import { StreamerMode } from './streamer/StreamerMode';
import { disposeLogger, initializeLogger, logger } from './utils/Logger';
import { EnvironmentTreeProvider } from './views/EnvironmentTreeProvider';
import { StatusBar } from './status/StatusBar';
import { WelcomePanel } from './welcome/WelcomePanel';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(initializeLogger());
  logger.info('EnvShield activating');

  const configuration = new Configuration();
  const reveals = new RevealRegistry();
  const protection = new ScreenProtection();
  const streamerMode = new StreamerMode(configuration, protection);
  const secretStore = new SecretStore(context.secrets);
  const scanner = new WorkspaceScanner(configuration, secretStore);

  const tree = new EnvironmentTreeProvider({
    configuration,
    reveals,
    protection,
    streamerMode,
  });

  const treeView = vscode.window.createTreeView('envshield.environment', {
    treeDataProvider: tree,
    showCollapseAll: true,
  });

  const statusBar = new StatusBar({ configuration, reveals, protection, streamerMode });

  const commandContext: CommandContext = {
    extensionContext: context,
    configuration,
    reveals,
    protection,
    streamerMode,
    scanner,
    tree,
  };

  context.subscriptions.push(
    configuration,
    reveals,
    protection,
    streamerMode,
    scanner,
    tree,
    treeView,
    statusBar,
    EnvEditorProvider.register(context, {
      configuration,
      reveals,
      protection,
      streamerMode,
    }),
    ...registerCommands(commandContext),
    // Losing window focus is the cheapest available proxy for "the user just
    // switched to their streaming software": re-mask everything.
    vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) {
        reveals.hideAll();
        protection.enforce();
      }
    }),
  );

  void vscode.commands.executeCommand('setContext', 'envshield.active', true);

  if (configuration.settings.scanOnStartup) {
    void scanner
      .scanWorkspace()
      .then((summary) => scanner.notify(summary))
      .catch((error: unknown) => logger.error('Startup scan failed', error));
  }

  void WelcomePanel.showIfFirstRun(context);

  logger.info('EnvShield ready');
}

export function deactivate(): void {
  disposeLogger();
}
