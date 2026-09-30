/**
 * Typed, cached access to `kayshield.*` settings.
 *
 * This is the only module that reads workspace configuration. Everything else
 * receives plain data, which keeps the core testable and makes it obvious where
 * user input enters the extension.
 */

import * as vscode from 'vscode';
import type { DetectionRules } from '../types';
import type { UserPattern } from '../security/SecretDetector';
import { normalizeMaskCharacter } from '../security/MaskingEngine';
import { DEFAULT_FILE_PATTERNS } from '../env/EnvFileDetector';

export const CONFIG_SECTION = 'kayshield';

/** Reveal timeouts offered by the settings UI, in milliseconds. */
export const REVEAL_TIMEOUTS = [0, 1000, 3000, 5000, 10000, 30000] as const;

export interface KayShieldSettings {
  readonly enabled: boolean;
  readonly streamerMode: boolean;
  readonly revealTimeout: number;
  readonly maskCharacter: string;
  readonly maskPreserveLength: boolean;
  readonly autoDetectSecrets: boolean;
  readonly detectConfigFiles: boolean;
  readonly protectEnvExample: boolean;
  readonly filePatterns: readonly string[];
  readonly secretPatterns: readonly UserPattern[];
  readonly ignoredVariables: readonly string[];
  readonly alwaysMask: readonly string[];
  readonly neverMask: readonly string[];
  readonly maskThreshold: number;
  readonly showStatusBar: boolean;
  readonly scanOnStartup: boolean;
  readonly configFileGlobs: readonly string[];
}

function readStringArray(
  config: vscode.WorkspaceConfiguration,
  key: string,
  fallback: readonly string[],
): readonly string[] {
  const value = config.get<unknown>(key);
  if (!Array.isArray(value)) {
    return fallback;
  }
  const filtered = value.filter((item): item is string => typeof item === 'string');
  return filtered.length > 0 || value.length === 0 ? filtered : fallback;
}

function readUserPatterns(config: vscode.WorkspaceConfiguration): readonly UserPattern[] {
  const value = config.get<unknown>('secretPatterns');
  if (!Array.isArray(value)) {
    return [];
  }
  const patterns: UserPattern[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const candidate = entry as Partial<UserPattern>;
    if (typeof candidate.name !== 'string' || typeof candidate.pattern !== 'string') {
      continue;
    }
    patterns.push({
      name: candidate.name,
      pattern: candidate.pattern,
      target: candidate.target === 'key' ? 'key' : 'value',
      score: typeof candidate.score === 'number' ? candidate.score : 100,
    });
  }
  return patterns;
}

/**
 * Reads settings once and re-reads them only when VS Code reports a change.
 * Configuration lookups are cheap but not free, and detection runs per variable.
 */
export class Configuration implements vscode.Disposable {
  private cached: KayShieldSettings;
  private readonly emitter = new vscode.EventEmitter<KayShieldSettings>();
  private readonly disposables: vscode.Disposable[] = [];

  readonly onDidChange = this.emitter.event;

  constructor() {
    this.cached = Configuration.read();
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration(CONFIG_SECTION)) {
          return;
        }
        this.cached = Configuration.read();
        this.emitter.fire(this.cached);
      }),
    );
  }

  get settings(): KayShieldSettings {
    return this.cached;
  }

  /** Detection rules for a document, honouring the template exemption. */
  rulesFor(treatAsPublic: boolean): DetectionRules {
    return {
      alwaysMask: this.cached.alwaysMask,
      neverMask: this.cached.neverMask,
      ignoredVariables: this.cached.ignoredVariables,
      autoDetectSecrets: this.cached.autoDetectSecrets,
      maskThreshold: this.cached.maskThreshold,
      treatAsPublic,
    };
  }

  static read(): KayShieldSettings {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const revealTimeout = config.get<number>('revealTimeout', 5000);
    return {
      enabled: config.get<boolean>('enabled', true),
      streamerMode: config.get<boolean>('streamerMode', false),
      revealTimeout: Number.isFinite(revealTimeout) && revealTimeout >= 0 ? revealTimeout : 5000,
      maskCharacter: normalizeMaskCharacter(config.get<string>('maskCharacter', '•')),
      maskPreserveLength: config.get<boolean>('maskPreserveLength', false),
      autoDetectSecrets: config.get<boolean>('autoDetectSecrets', true),
      detectConfigFiles: config.get<boolean>('detectConfigFiles', true),
      protectEnvExample: config.get<boolean>('protectEnvExample', false),
      filePatterns: readStringArray(config, 'filePatterns', DEFAULT_FILE_PATTERNS),
      secretPatterns: readUserPatterns(config),
      ignoredVariables: readStringArray(config, 'ignoredVariables', []),
      alwaysMask: readStringArray(config, 'alwaysMask', []),
      neverMask: readStringArray(config, 'neverMask', []),
      maskThreshold: config.get<number>('maskThreshold', 61),
      showStatusBar: config.get<boolean>('showStatusBar', true),
      scanOnStartup: config.get<boolean>('scanOnStartup', false),
      configFileGlobs: readStringArray(config, 'configFileGlobs', [
        '**/*.json',
        '**/*.yaml',
        '**/*.yml',
        '**/*.toml',
      ]),
    };
  }

  /** Writes a setting, preferring the workspace scope when one is open. */
  static async update(key: string, value: unknown): Promise<void> {
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await vscode.workspace.getConfiguration(CONFIG_SECTION).update(key, value, target);
  }

  /** Appends a value to a string-array setting, without duplicates. */
  static async addToList(key: string, value: string): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const current = config.get<string[]>(key, []);
    if (current.includes(value)) {
      return;
    }
    await Configuration.update(key, [...current, value]);
  }

  dispose(): void {
    this.emitter.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}
