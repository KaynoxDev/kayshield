/**
 * Workspace scanning and diagnostics.
 *
 * This is the "human error" guard from the specification: a token pasted into
 * `config.json`, a password left in `docker-compose.yml`. Findings are surfaced
 * as VS Code diagnostics, which means the Problems panel, the file decorations
 * and the editor squiggles all work with no extra UI.
 *
 * SECURITY: a diagnostic message contains the variable name, the severity and
 * the detector's reason. Never the value, never a fragment of it, never its
 * length. The same holds for the notification.
 *
 * PERFORMANCE: scanning is on demand plus on save. There is no polling, no
 * background crawler and no watcher over the whole workspace.
 */

import * as vscode from 'vscode';
import type { Configuration } from '../config/Configuration';
import type { SecretStore } from '../config/SecretStore';
import { classifyEnvFile } from '../env/EnvFileDetector';
import { createAnalyzer } from '../security/SecretDetector';
import { SecurityScanner, scanKindFor, type SecretFinding } from '../security/SecurityScanner';
import { logger, safeLogError } from '../utils/Logger';

const EXCLUDE_GLOB = '**/{node_modules,.git,dist,out,build,vendor,.next,.venv,target,coverage}/**';
const MAX_FILES = 400;
/** Files larger than this are skipped: they are not hand-written config. */
const MAX_FILE_BYTES = 512 * 1024;

export interface ScanSummary {
  readonly fileCount: number;
  readonly findingCount: number;
}

export class WorkspaceScanner implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('kayshield');
  private readonly disposables: vscode.Disposable[] = [];
  private scanner: SecurityScanner;
  private lastNotifiedCount = -1;
  private scanning = false;
  /** Findings of the last run, so "Ignore" knows what to remember. */
  private lastFindings: { uri: vscode.Uri; finding: SecretFinding }[] = [];

  constructor(
    private readonly configuration: Configuration,
    private readonly store: SecretStore,
  ) {
    this.scanner = new SecurityScanner(createAnalyzer(configuration.settings.secretPatterns));

    this.disposables.push(
      this.diagnostics,
      configuration.onDidChange((settings) => {
        this.scanner = new SecurityScanner(createAnalyzer(settings.secretPatterns));
        if (!settings.detectConfigFiles) {
          this.diagnostics.clear();
        }
      }),
      // Re-check a file the user just saved, but only if we already know it.
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (this.diagnostics.get(document.uri)?.length) {
          void this.scanDocument(document);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document.uri.scheme === 'untitled') {
          this.diagnostics.delete(document.uri);
        }
      }),
    );
  }

  /** Scans one open document and refreshes its diagnostics. */
  async scanDocument(document: vscode.TextDocument): Promise<SecretFinding[]> {
    const settings = this.configuration.settings;
    const classification = classifyEnvFile(document.uri.path, {
      filePatterns: settings.filePatterns,
      protectEnvExample: settings.protectEnvExample,
    });

    if (classification.treatAsPublic) {
      this.diagnostics.delete(document.uri);
      return [];
    }
    if (!classification.isEnvFile && !settings.detectConfigFiles) {
      this.diagnostics.delete(document.uri);
      return [];
    }

    const findings = await this.withoutIgnored(
      document.uri,
      this.scanner.scan(
        document.getText(),
        scanKindFor(classification.fileName),
        this.configuration.rulesFor(false),
      ),
    );

    this.publish(document.uri, findings);
    return findings;
  }

  /** Drops findings the user explicitly chose to ignore. */
  private async withoutIgnored(
    uri: vscode.Uri,
    findings: readonly SecretFinding[],
  ): Promise<SecretFinding[]> {
    const kept: SecretFinding[] = [];
    for (const finding of findings) {
      if (!(await this.store.isIgnored(uri.path, finding.key))) {
        kept.push(finding);
      }
    }
    return kept;
  }

  /** Full workspace scan. Reports progress and returns a summary. */
  async scanWorkspace(): Promise<ScanSummary> {
    if (this.scanning) {
      return { fileCount: 0, findingCount: 0 };
    }
    this.scanning = true;
    try {
      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: vscode.l10n.t('KayShield: scanning workspace'),
        },
        async (_progress, token) => this.runScan(token),
      );
    } finally {
      this.scanning = false;
    }
  }

  private async runScan(token: vscode.CancellationToken): Promise<ScanSummary> {
    const settings = this.configuration.settings;
    this.diagnostics.clear();

    const globs = ['**/{.env*,*.env}'];
    if (settings.detectConfigFiles) {
      globs.push(...settings.configFileGlobs);
    }

    const seen = new Set<string>();
    const uris: vscode.Uri[] = [];
    for (const glob of globs) {
      if (token.isCancellationRequested) {
        break;
      }
      try {
        const found = await vscode.workspace.findFiles(glob, EXCLUDE_GLOB, MAX_FILES);
        for (const uri of found) {
          const key = uri.toString();
          if (!seen.has(key)) {
            seen.add(key);
            uris.push(uri);
          }
        }
      } catch (error) {
        safeLogError('findFiles failed', error);
      }
    }

    let findingCount = 0;
    let fileCount = 0;
    this.lastFindings = [];

    for (const uri of uris) {
      if (token.isCancellationRequested) {
        break;
      }
      const findings = await this.scanUri(uri);
      if (findings === undefined) {
        continue;
      }
      fileCount += 1;
      findingCount += findings.length;
      for (const finding of findings) {
        this.lastFindings.push({ uri, finding });
      }
    }

    logger.info(`Workspace scan finished: ${fileCount} files, ${findingCount} findings`);
    return { fileCount, findingCount };
  }

  private async scanUri(uri: vscode.Uri): Promise<SecretFinding[] | undefined> {
    const settings = this.configuration.settings;
    const classification = classifyEnvFile(uri.path, {
      filePatterns: settings.filePatterns,
      protectEnvExample: settings.protectEnvExample,
    });
    if (classification.treatAsPublic) {
      return undefined;
    }

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > MAX_FILE_BYTES) {
        return undefined;
      }
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      const findings = await this.withoutIgnored(
        uri,
        this.scanner.scan(
          text,
          scanKindFor(classification.fileName),
          this.configuration.rulesFor(false),
        ),
      );
      this.publish(uri, findings);
      return findings;
    } catch (error) {
      safeLogError('Could not scan file', error);
      return undefined;
    }
  }

  private publish(uri: vscode.Uri, findings: readonly SecretFinding[]): void {
    if (findings.length === 0) {
      this.diagnostics.delete(uri);
      return;
    }
    this.diagnostics.set(
      uri,
      findings.map((finding) => {
        const range = new vscode.Range(
          finding.line,
          Math.max(finding.column, 0),
          finding.line,
          Math.max(finding.column, 0) + finding.length,
        );
        // Value-free message.
        const diagnostic = new vscode.Diagnostic(
          range,
          vscode.l10n.t('Potential secret in "{0}". {1}', finding.key, finding.summary),
          finding.severity === 'secret'
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Information,
        );
        diagnostic.source = 'KayShield';
        diagnostic.code = finding.severity;
        return diagnostic;
      }),
    );
  }

  /**
   * One notification per distinct result, never repeated for the same count.
   * The value is never shown, only how many were found.
   */
  async notify(summary: ScanSummary): Promise<void> {
    if (summary.findingCount === 0) {
      if (this.lastNotifiedCount !== 0) {
        this.lastNotifiedCount = 0;
        await vscode.window.showInformationMessage(
          vscode.l10n.t('KayShield found no exposed secret in {0} files.', summary.fileCount),
        );
      }
      return;
    }
    if (summary.findingCount === this.lastNotifiedCount) {
      return;
    }
    this.lastNotifiedCount = summary.findingCount;

    const review = vscode.l10n.t('Review');
    const ignore = vscode.l10n.t('Ignore these');
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t('KayShield detected {0} potential secrets.', summary.findingCount),
      review,
      ignore,
    );
    if (choice === review) {
      await vscode.commands.executeCommand('workbench.actions.view.problems');
      return;
    }
    if (choice === ignore) {
      // Only a salted fingerprint of "path + variable name" is stored.
      for (const { uri, finding } of this.lastFindings) {
        await this.store.ignore(uri.path, finding.key);
      }
      this.diagnostics.clear();
    }
  }

  clear(): void {
    this.diagnostics.clear();
    this.lastNotifiedCount = -1;
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}
