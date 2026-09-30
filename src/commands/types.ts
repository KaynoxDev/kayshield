/** Everything a command needs. Passed explicitly so commands stay testable. */

import type * as vscode from 'vscode';
import type { Configuration } from '../config/Configuration';
import type { RevealRegistry } from '../security/RevealRegistry';
import type { WorkspaceScanner } from '../scan/WorkspaceScanner';
import type { ScreenProtection } from '../streamer/ScreenProtection';
import type { StreamerMode } from '../streamer/StreamerMode';
import type { EnvironmentTreeProvider } from '../views/EnvironmentTreeProvider';

export interface CommandContext {
  readonly extensionContext: vscode.ExtensionContext;
  readonly configuration: Configuration;
  readonly reveals: RevealRegistry;
  readonly protection: ScreenProtection;
  readonly streamerMode: StreamerMode;
  readonly scanner: WorkspaceScanner;
  readonly tree: EnvironmentTreeProvider;
}
