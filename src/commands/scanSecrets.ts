/** Scan the workspace for exposed secrets and report the count - never a value. */

import type { CommandContext } from './types';

export function scanWorkspace(context: CommandContext) {
  return async (): Promise<void> => {
    const summary = await context.scanner.scanWorkspace();
    context.tree.refresh();
    // Fire and forget: `notify` waits for the user to answer the notification,
    // and the command must not stay pending for as long as that takes.
    void context.scanner.notify(summary);
  };
}
