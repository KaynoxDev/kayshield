/**
 * The secure editor.
 *
 * Implemented as a `CustomTextEditorProvider` rather than a full
 * `CustomEditorProvider`: the file remains a normal `TextDocument`, so saving,
 * dirty state, undo/redo, hot exit, Git integration and the "Open as Plain
 * Text" escape hatch all keep working with no extra code and no extra risk.
 *
 * ANTI-FLASH (the reason this is not a decoration-based approach): the webview
 * HTML is generated on the host with values already masked. The payload
 * embedded in the initial document contains mask characters only. There is no
 * moment, not even a single frame, where the webview holds a plaintext secret
 * it was not explicitly asked to show.
 */

import * as vscode from 'vscode';
import type { Configuration } from '../config/Configuration';
import { countSecrets, toMaskedVariables } from '../env/EnvVariable';
import { MaskingEngine } from '../security/MaskingEngine';
import type { RevealRegistry } from '../security/RevealRegistry';
import { createAnalyzer, type SecretAnalyzer } from '../security/SecretDetector';
import type { ScreenProtection } from '../streamer/ScreenProtection';
import type { StreamerMode } from '../streamer/StreamerMode';
import type { EnvironmentVariable, MaskedVariable } from '../types';
import { debounce } from '../utils/async';
import { createNonce, escapeHtml } from '../utils/html';
import { logger } from '../utils/Logger';
import { EnvDocument } from './EnvDocument';
import {
  isWebviewMessage,
  type HostMessage,
  type WebviewMessage,
  type WebviewState,
} from './protocol';

export const ENV_EDITOR_VIEW_TYPE = 'envshield.envEditor';

/** How long we wait after a document change before re-rendering. */
const REPARSE_DEBOUNCE_MS = 120;

export interface EnvEditorDependencies {
  readonly configuration: Configuration;
  readonly reveals: RevealRegistry;
  readonly protection: ScreenProtection;
  readonly streamerMode: StreamerMode;
}

interface Snapshot {
  readonly variables: readonly EnvironmentVariable[];
  readonly masked: readonly MaskedVariable[];
  readonly state: WebviewState;
}

export class EnvEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
  private analyzer: SecretAnalyzer;
  private readonly masking = new MaskingEngine();
  private readonly ownDisposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly deps: EnvEditorDependencies,
  ) {
    this.analyzer = createAnalyzer(deps.configuration.settings.secretPatterns);
    this.applySettings();
    this.ownDisposables.push(deps.configuration.onDidChange(() => this.applySettings()));
  }

  static register(
    context: vscode.ExtensionContext,
    deps: EnvEditorDependencies,
  ): vscode.Disposable {
    const provider = new EnvEditorProvider(context.extensionUri, deps);
    const registration = vscode.window.registerCustomEditorProvider(
      ENV_EDITOR_VIEW_TYPE,
      provider,
      {
        webviewOptions: {
          // Deliberately false: a hidden tab drops its DOM, and with it every
          // revealed value. Coming back always starts from the masked state.
          retainContextWhenHidden: false,
        },
        supportsMultipleEditorsPerDocument: true,
      },
    );
    return new vscode.Disposable(() => {
      registration.dispose();
      provider.dispose();
    });
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const envDocument = new EnvDocument(document);
    const disposables: vscode.Disposable[] = [];

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    panel.webview.html = this.buildHtml(panel.webview, envDocument);

    const post = (message: HostMessage): void => {
      void panel.webview.postMessage(message);
    };

    const pushUpdate = (): void => {
      const snapshot = this.snapshot(envDocument);
      post({ type: 'update', variables: snapshot.masked, state: snapshot.state });
    };
    const pushUpdateDebounced = debounce(pushUpdate, REPARSE_DEBOUNCE_MS);

    disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === document.uri.toString()) {
          pushUpdateDebounced();
        }
      }),
      this.deps.configuration.onDidChange(() => pushUpdate()),
      this.deps.protection.onDidChange(() => {
        post({ type: 'mask' });
        pushUpdate();
      }),
      this.deps.reveals.onDidChange((change) => {
        if (change.uri !== document.uri.toString()) {
          return;
        }
        if (!change.revealed) {
          post({ type: 'mask', id: change.variableId });
        }
        pushUpdate();
      }),
      // Losing visibility is treated as a potential screen change: drop every
      // revealed value rather than betting on the user's window layout.
      panel.onDidChangeViewState((event) => {
        if (!event.webviewPanel.visible) {
          this.deps.reveals.hideDocument(document.uri);
        }
      }),
      this.deps.protection.register({
        id: `editor:${document.uri.toString()}:${panelId(panel)}`,
        engage: () => {
          this.deps.reveals.hideDocument(document.uri);
          post({ type: 'mask' });
        },
        disengage: () => pushUpdate(),
      }),
      panel.webview.onDidReceiveMessage((raw: unknown) => {
        if (!isWebviewMessage(raw)) {
          return;
        }
        void this.handleMessage(raw, envDocument, post, pushUpdate);
      }),
    );

    panel.onDidDispose(() => {
      pushUpdateDebounced.cancel();
      this.deps.reveals.hideDocument(document.uri);
      for (const disposable of disposables) {
        disposable.dispose();
      }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Messages                                                                */
  /* ---------------------------------------------------------------------- */

  private async handleMessage(
    message: WebviewMessage,
    envDocument: EnvDocument,
    post: (message: HostMessage) => void,
    pushUpdate: () => void,
  ): Promise<void> {
    const uri = envDocument.uri;

    switch (message.type) {
      case 'ready':
        pushUpdate();
        return;

      case 'reveal': {
        if (!this.canReveal(post)) {
          return;
        }
        const node = envDocument.node(message.id);
        if (!node) {
          return;
        }
        const timeout = this.deps.configuration.settings.revealTimeout;
        this.deps.reveals.reveal(uri, message.id, timeout);
        // The only plaintext that ever crosses the boundary, one value at a time.
        post({ type: 'value', id: message.id, value: node.value, timeout });
        return;
      }

      case 'hide':
        this.deps.reveals.hide(uri, message.id);
        return;

      case 'hideAll':
        this.deps.reveals.hideDocument(uri);
        post({ type: 'mask' });
        return;

      case 'revealAll': {
        if (!this.canReveal(post)) {
          return;
        }
        const timeout = this.deps.configuration.settings.revealTimeout;
        for (const variable of this.snapshot(envDocument).variables) {
          if (!variable.secret) {
            continue;
          }
          this.deps.reveals.reveal(uri, variable.id, timeout);
          post({ type: 'value', id: variable.id, value: variable.value, timeout });
        }
        return;
      }

      case 'toggleStreamerMode':
        await vscode.commands.executeCommand('envshield.toggleStreamerMode');
        return;

      case 'copy': {
        const node = envDocument.node(message.id);
        if (!node) {
          return;
        }
        await vscode.env.clipboard.writeText(node.value);
        post({
          type: 'toast',
          text: vscode.l10n.t('Value of {0} copied to the clipboard.', node.key),
          tone: 'info',
        });
        return;
      }

      case 'edit':
        await envDocument.setValue(message.id, message.value);
        pushUpdate();
        return;

      case 'rename':
        await envDocument.renameVariable(message.id, message.key);
        pushUpdate();
        return;

      case 'delete':
        this.deps.reveals.hide(uri, message.id);
        await envDocument.deleteVariable(message.id);
        pushUpdate();
        return;

      case 'add':
        await envDocument.addVariable(message.key, message.value);
        pushUpdate();
        return;

      case 'openAsText':
        await vscode.commands.executeCommand(
          'vscode.openWith',
          uri,
          'default',
          vscode.ViewColumn.Active,
        );
        return;

      default:
        logger.warn('Unknown webview message ignored');
    }
  }

  /** Single choke point for every reveal path. */
  private canReveal(post: (message: HostMessage) => void): boolean {
    if (!this.deps.streamerMode.enabled && !this.deps.protection.isEngaged) {
      return true;
    }
    post({
      type: 'toast',
      text: vscode.l10n.t('Streamer Mode is on. Turn it off to reveal a value.'),
      tone: 'warning',
    });
    return false;
  }

  /* ---------------------------------------------------------------------- */
  /* Rendering                                                               */
  /* ---------------------------------------------------------------------- */

  private snapshot(envDocument: EnvDocument): Snapshot {
    const settings = this.deps.configuration.settings;
    const treatAsPublic = envDocument.isTemplate(settings.protectEnvExample);
    const variables = envDocument.variables({
      analyzer: this.analyzer,
      rules: this.deps.configuration.rulesFor(treatAsPublic),
      revealed: this.deps.reveals.revealedIds(envDocument.uri),
      forceMask: this.deps.streamerMode.enabled || this.deps.protection.isEngaged,
    });

    return {
      variables,
      masked: toMaskedVariables(variables, this.masking),
      state: {
        fileName: envDocument.uri.path.split('/').pop() ?? '.env',
        streamerMode: this.deps.streamerMode.enabled || this.deps.protection.isEngaged,
        revealTimeout: settings.revealTimeout,
        isTemplate: treatAsPublic,
        secretCount: countSecrets(variables),
        totalCount: variables.length,
        readOnly: !vscode.workspace.fs.isWritableFileSystem(envDocument.uri.scheme),
      },
    };
  }

  private applySettings(): void {
    const settings = this.deps.configuration.settings;
    this.masking.update({
      maskCharacter: settings.maskCharacter,
      preserveLength: settings.maskPreserveLength,
    });
    // Rebuild rather than append, so the committee never grows unbounded.
    this.analyzer = createAnalyzer(settings.secretPatterns);
  }

  /**
   * Builds the initial HTML.
   *
   * The embedded JSON payload comes from `toMaskedVariables`: every secret is
   * already replaced by mask characters at this point, so even the very first
   * paint - before any script runs - is safe to show on a stream.
   */
  private buildHtml(webview: vscode.Webview, envDocument: EnvDocument): string {
    const nonce = createNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'editor.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'editor.css'),
    );

    const snapshot = this.snapshot(envDocument);
    const payload = {
      type: 'init' as const,
      variables: snapshot.masked,
      state: snapshot.state,
      strings: webviewStrings(),
    };

    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    // Embedded rather than posted, so the first frame is already correct.
    const serialized = JSON.stringify(payload).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<html lang="${escapeHtml(vscode.env.language)}">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>${escapeHtml(snapshot.state.fileName)}</title>
  </head>
  <body>
    <div id="app" aria-busy="true"></div>
    <script id="envshield-payload" type="application/json" nonce="${nonce}">${serialized}</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  dispose(): void {
    for (const disposable of this.ownDisposables) {
      disposable.dispose();
    }
  }
}

let panelCounter = 0;
const panelIds = new WeakMap<vscode.WebviewPanel, number>();

/** Stable id per panel, so two editors on the same file register separately. */
function panelId(panel: vscode.WebviewPanel): number {
  let id = panelIds.get(panel);
  if (id === undefined) {
    panelCounter += 1;
    id = panelCounter;
    panelIds.set(panel, id);
  }
  return id;
}

/** UI strings, translated on the host and handed to the webview. */
function webviewStrings(): Record<string, string> {
  return {
    title: vscode.l10n.t('Environment Variables'),
    searchPlaceholder: vscode.l10n.t('Search variables...'),
    searchNote: vscode.l10n.t('Search matches variable names only, never values.'),
    variable: vscode.l10n.t('Variable'),
    value: vscode.l10n.t('Value'),
    actions: vscode.l10n.t('Actions'),
    reveal: vscode.l10n.t('Reveal {0}'),
    hide: vscode.l10n.t('Hide {0}'),
    copy: vscode.l10n.t('Copy value of {0}'),
    edit: vscode.l10n.t('Edit value of {0}'),
    remove: vscode.l10n.t('Delete {0}'),
    addVariable: vscode.l10n.t('Add variable'),
    hideAll: vscode.l10n.t('Hide all'),
    revealAll: vscode.l10n.t('Reveal all'),
    openAsText: vscode.l10n.t('Open as text'),
    streamOn: vscode.l10n.t('STREAM MODE ON'),
    streamOff: vscode.l10n.t('Streamer Mode'),
    streamHint: vscode.l10n.t('Every sensitive value stays masked while Streamer Mode is on.'),
    templateHint: vscode.l10n.t(
      'Template file: values are shown because they are considered placeholders.',
    ),
    empty: vscode.l10n.t('(empty)'),
    noResults: vscode.l10n.t('No variable matches your search.'),
    noVariables: vscode.l10n.t('This file contains no variable yet.'),
    protectedSummary: vscode.l10n.t('{0} of {1} protected'),
    keyLabel: vscode.l10n.t('Name'),
    valueLabel: vscode.l10n.t('Value'),
    save: vscode.l10n.t('Save'),
    cancel: vscode.l10n.t('Cancel'),
    readOnly: vscode.l10n.t('This file is read-only.'),
    severitySecret: vscode.l10n.t('Secret'),
    severitySensitive: vscode.l10n.t('Sensitive'),
    severitySuspicious: vscode.l10n.t('Suspicious'),
    severityNormal: vscode.l10n.t('Normal'),
  };
}
