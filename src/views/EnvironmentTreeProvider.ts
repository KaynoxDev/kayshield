/**
 * The EnvShield section in the Explorer.
 *
 * Lists the environment files of the workspace, and their variables on demand.
 * Files are discovered once and refreshed from a file system watcher; a file is
 * only ever parsed when its node is expanded, so the tree costs nothing while
 * it is collapsed.
 */

import * as vscode from 'vscode';
import type { Configuration } from '../config/Configuration';
import { classifyEnvFile } from '../env/EnvFileDetector';
import { parseEnv } from '../env/EnvParser';
import { buildVariables } from '../env/EnvVariable';
import { MaskingEngine } from '../security/MaskingEngine';
import type { RevealRegistry } from '../security/RevealRegistry';
import { createAnalyzer, type SecretAnalyzer } from '../security/SecretDetector';
import type { ScreenProtection } from '../streamer/ScreenProtection';
import type { StreamerMode } from '../streamer/StreamerMode';
import type { EnvironmentVariable } from '../types';
import { safeLogError } from '../utils/Logger';
import {
  EnvFileItem,
  EnvMessageItem,
  EnvVariableItem,
  type EnvTreeItem,
} from './EnvironmentTreeItem';

/** Directories never worth scanning. */
const EXCLUDE_GLOB = '**/{node_modules,.git,dist,out,build,vendor,.next,.venv,target}/**';

export interface TreeDependencies {
  readonly configuration: Configuration;
  readonly reveals: RevealRegistry;
  readonly protection: ScreenProtection;
  readonly streamerMode: StreamerMode;
}

interface FileSummary {
  readonly uri: vscode.Uri;
  readonly relativePath: string;
  readonly variables: readonly EnvironmentVariable[];
}

export class EnvironmentTreeProvider
  implements vscode.TreeDataProvider<EnvTreeItem>, vscode.Disposable
{
  private readonly emitter = new vscode.EventEmitter<EnvTreeItem | undefined>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly masking = new MaskingEngine();
  private analyzer: SecretAnalyzer;
  private files: vscode.Uri[] | undefined;

  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly deps: TreeDependencies) {
    this.analyzer = createAnalyzer(deps.configuration.settings.secretPatterns);
    this.applySettings();

    const watcher = vscode.workspace.createFileSystemWatcher('**/.env*');
    const envWatcher = vscode.workspace.createFileSystemWatcher('**/*.env');
    const invalidate = (): void => {
      this.files = undefined;
      this.refresh();
    };

    this.disposables.push(
      watcher,
      envWatcher,
      watcher.onDidCreate(invalidate),
      watcher.onDidDelete(invalidate),
      watcher.onDidChange(() => this.refresh()),
      envWatcher.onDidCreate(invalidate),
      envWatcher.onDidDelete(invalidate),
      envWatcher.onDidChange(() => this.refresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(invalidate),
      this.deps.configuration.onDidChange(() => {
        this.applySettings();
        invalidate();
      }),
      this.deps.reveals.onDidChange(() => this.refresh()),
      this.deps.protection.onDidChange(() => this.refresh()),
      this.deps.protection.register({
        id: 'tree',
        engage: () => this.refresh(),
        disengage: () => this.refresh(),
      }),
    );
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  /** Drops the discovery cache and reloads. */
  reload(): void {
    this.files = undefined;
    this.refresh();
  }

  getTreeItem(element: EnvTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: EnvTreeItem): Promise<EnvTreeItem[]> {
    if (!this.deps.configuration.settings.enabled) {
      return [new EnvMessageItem(vscode.l10n.t('EnvShield is disabled'), 'circle-slash')];
    }

    if (element === undefined) {
      return this.rootItems();
    }
    if (element instanceof EnvFileItem) {
      const summary = await this.summarize(element.uri);
      if (!summary || summary.variables.length === 0) {
        return [new EnvMessageItem(vscode.l10n.t('No variable'), 'blank')];
      }
      return summary.variables.map(
        (variable) =>
          new EnvVariableItem(
            element.uri,
            variable,
            this.masking.display(variable.value, variable.masked),
          ),
      );
    }
    return [];
  }

  private async rootItems(): Promise<EnvTreeItem[]> {
    const uris = await this.discover();
    if (uris.length === 0) {
      return [];
    }

    const items: EnvTreeItem[] = [];
    let totalSecrets = 0;

    for (const uri of uris) {
      const summary = await this.summarize(uri);
      if (!summary) {
        continue;
      }
      const secretCount = summary.variables.filter((variable) => variable.secret).length;
      totalSecrets += secretCount;
      items.push(new EnvFileItem(uri, summary.relativePath, secretCount, summary.variables.length));
    }

    if (totalSecrets > 0) {
      items.push(
        new EnvMessageItem(
          vscode.l10n.t('{0} protected in this workspace', totalSecrets),
          'shield',
          {
            command: 'envshield.scanWorkspace',
            title: vscode.l10n.t('Scan Workspace'),
          },
        ),
      );
    }

    return items;
  }

  /** Finds environment files once per workspace change. */
  private async discover(): Promise<vscode.Uri[]> {
    if (this.files) {
      return this.files;
    }
    try {
      const found = await vscode.workspace.findFiles('**/{.env*,*.env}', EXCLUDE_GLOB, 200);
      const patterns = this.deps.configuration.settings.filePatterns;
      this.files = found
        .filter((uri) => classifyEnvFile(uri.path, { filePatterns: patterns }).isEnvFile)
        .sort((a, b) => a.path.localeCompare(b.path));
    } catch (error) {
      safeLogError('Environment file discovery failed', error);
      this.files = [];
    }
    return this.files;
  }

  private async summarize(uri: vscode.Uri): Promise<FileSummary | undefined> {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const settings = this.deps.configuration.settings;
      const classification = classifyEnvFile(uri.path, {
        filePatterns: settings.filePatterns,
        protectEnvExample: settings.protectEnvExample,
      });
      const variables = buildVariables(parseEnv(document.getText()), {
        analyzer: this.analyzer,
        rules: this.deps.configuration.rulesFor(classification.treatAsPublic),
        revealed: this.deps.reveals.revealedIds(uri),
        forceMask: this.deps.streamerMode.enabled || this.deps.protection.isEngaged,
      });
      return {
        uri,
        relativePath: vscode.workspace.asRelativePath(uri, false),
        variables,
      };
    } catch (error) {
      safeLogError('Could not read environment file', error);
      return undefined;
    }
  }

  private applySettings(): void {
    const settings = this.deps.configuration.settings;
    this.masking.update({
      maskCharacter: settings.maskCharacter,
      preserveLength: settings.maskPreserveLength,
    });
    this.analyzer = createAnalyzer(settings.secretPatterns);
  }

  dispose(): void {
    this.emitter.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}
