/**
 * First-run experience.
 *
 * A single webview panel, shown once per installation, that states plainly what
 * EnvShield does and - just as importantly - what it cannot do. It contains no
 * variable, no value and no workspace data of any kind: it is a static page.
 */

import * as vscode from 'vscode';
import { Configuration } from '../config/Configuration';
import { createNonce, escapeHtml } from '../utils/html';

const SEEN_KEY = 'envshield.welcomeShown';
const VIEW_TYPE = 'envshield.welcome';

export class WelcomePanel {
  private static current: vscode.WebviewPanel | undefined;

  /** Shows the panel once per installation. */
  static async showIfFirstRun(context: vscode.ExtensionContext): Promise<void> {
    if (context.globalState.get<boolean>(SEEN_KEY) === true) {
      return;
    }
    await context.globalState.update(SEEN_KEY, true);
    WelcomePanel.show(context);
  }

  static show(context: vscode.ExtensionContext): void {
    if (WelcomePanel.current) {
      WelcomePanel.current.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      vscode.l10n.t('Welcome to EnvShield'),
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
        retainContextWhenHidden: false,
      },
    );

    panel.webview.html = render(panel.webview, context.extensionUri);
    panel.onDidDispose(() => {
      WelcomePanel.current = undefined;
    });

    panel.webview.onDidReceiveMessage(async (message: { type?: string }) => {
      if (message?.type === 'enable') {
        await Configuration.update('enabled', true);
        await vscode.window.showInformationMessage(vscode.l10n.t('EnvShield protection is on.'));
        panel.dispose();
      } else if (message?.type === 'configure') {
        await vscode.commands.executeCommand('envshield.configure');
      }
    });

    WelcomePanel.current = panel;
  }
}

function render(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = createNonce();
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'editor.css'));
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  const features = [
    vscode.l10n.t('Automatic secret detection, scored rather than guessed'),
    vscode.l10n.t('One-click reveal, with an automatic timeout'),
    vscode.l10n.t('Streamer Mode: one shortcut and nothing sensitive can be shown'),
    vscode.l10n.t('Local-only processing: no network call, no telemetry'),
    vscode.l10n.t('Your .env files keep their exact format'),
  ];

  const limits = vscode.l10n.t(
    'EnvShield protects what it renders inside VS Code. It cannot mask the integrated terminal, the debug console, another extension, or an application outside the editor.',
  );

  return `<!DOCTYPE html>
<html lang="${escapeHtml(vscode.env.language)}">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <style nonce="${nonce}">
      .welcome { max-width: 640px; margin: 0 auto; padding: 40px 24px; }
      .welcome h1 { font-size: 20px; margin: 0 0 6px; }
      .welcome p.lead { color: var(--vscode-descriptionForeground); margin: 0 0 24px; }
      .welcome ul { list-style: none; padding: 0; margin: 0 0 24px; }
      .welcome li { padding: 6px 0 6px 24px; position: relative; }
      .welcome li::before { content: '✓'; position: absolute; left: 0; opacity: 0.8; }
      .welcome .actions { display: flex; gap: 8px; margin-bottom: 28px; }
    </style>
    <title>${escapeHtml(vscode.l10n.t('Welcome to EnvShield'))}</title>
  </head>
  <body>
    <main class="welcome">
      <h1>${escapeHtml(vscode.l10n.t('Welcome to EnvShield'))}</h1>
      <p class="lead">${escapeHtml(
        vscode.l10n.t(
          'Protect your environment variables while coding, streaming or sharing your screen.',
        ),
      )}</p>
      <ul>${features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul>
      <div class="actions">
        <button class="text primary" id="enable">${escapeHtml(
          vscode.l10n.t('Enable protection'),
        )}</button>
        <button class="text" id="configure">${escapeHtml(vscode.l10n.t('Configure'))}</button>
      </div>
      <p class="notice">${escapeHtml(limits)}</p>
    </main>
    <script nonce="${nonce}">
      const vscodeApi = acquireVsCodeApi();
      document.getElementById('enable').addEventListener('click', () => {
        vscodeApi.postMessage({ type: 'enable' });
      });
      document.getElementById('configure').addEventListener('click', () => {
        vscodeApi.postMessage({ type: 'configure' });
      });
    </script>
  </body>
</html>`;
}
