/**
 * Tree items for the KayShield Explorer section.
 *
 * SECURITY: a masked item's `description` and `tooltip` contain mask characters
 * and a value-free explanation. The real value only appears in `description`
 * after an explicit reveal, and never in the tooltip.
 */

import * as vscode from 'vscode';
import type { EnvironmentVariable, SecretSeverity } from '../types';

export type EnvTreeItem = EnvFileItem | EnvVariableItem | EnvMessageItem;

export class EnvFileItem extends vscode.TreeItem {
  override readonly contextValue = 'kayshield.file';

  constructor(
    readonly uri: vscode.Uri,
    readonly relativePath: string,
    secretCount: number,
    totalCount: number,
  ) {
    super(relativePath, vscode.TreeItemCollapsibleState.Collapsed);
    this.resourceUri = uri;
    this.iconPath = new vscode.ThemeIcon('shield');
    this.description =
      totalCount === 0
        ? vscode.l10n.t('empty')
        : vscode.l10n.t('{0} of {1} protected', secretCount, totalCount);
    this.tooltip = vscode.l10n.t('Open {0} in the KayShield editor', relativePath);
    this.command = {
      command: 'kayshield.openEnvironmentFile',
      title: vscode.l10n.t('Open Environment File'),
      arguments: [uri],
    };
  }
}

function severityIcon(severity: SecretSeverity, masked: boolean): vscode.ThemeIcon {
  if (!masked) {
    return new vscode.ThemeIcon('eye');
  }
  switch (severity) {
    case 'secret':
    case 'sensitive':
      return new vscode.ThemeIcon('lock');
    case 'suspicious':
      return new vscode.ThemeIcon('warning');
    default:
      return new vscode.ThemeIcon('symbol-string');
  }
}

export class EnvVariableItem extends vscode.TreeItem {
  override readonly contextValue: string;

  constructor(
    readonly uri: vscode.Uri,
    readonly variable: EnvironmentVariable,
    displayValue: string,
  ) {
    super(variable.key, vscode.TreeItemCollapsibleState.None);
    this.description = variable.value.length === 0 ? vscode.l10n.t('(empty)') : displayValue;
    this.iconPath = severityIcon(variable.severity, variable.masked);
    this.contextValue = variable.secret
      ? variable.masked
        ? 'kayshield.variable.masked'
        : 'kayshield.variable.revealed'
      : 'kayshield.variable.plain';

    // Value-free tooltip: severity, score and the detector's reason only.
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**${variable.key}**\n\n`);
    tooltip.appendMarkdown(`${variable.summary}\n\n`);
    tooltip.appendMarkdown(
      vscode.l10n.t('Severity: {0} - line {1}', variable.severity, variable.line + 1),
    );
    this.tooltip = tooltip;

    this.command = {
      command: 'kayshield.openEnvironmentFile',
      title: vscode.l10n.t('Open Environment File'),
      arguments: [uri],
    };
  }
}

/** A leaf used for empty states and scan summaries. */
export class EnvMessageItem extends vscode.TreeItem {
  constructor(label: string, iconId: string, command?: vscode.Command) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(iconId);
    if (command) {
      this.command = command;
    }
  }
}
