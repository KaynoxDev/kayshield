/**
 * Logging.
 *
 * There is exactly one way to log in EnvShield, and it redacts. `safeLog` runs
 * every message and every argument through {@link redactText} before anything
 * reaches the output channel, so a `.env` value cannot end up in a log file,
 * a bug report or a screen recording of the Output panel.
 *
 * Debug level is not an exception: there is no "raw" mode, by design.
 */

import * as vscode from 'vscode';
import { redactText, redactUnknown } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let channel: vscode.LogOutputChannel | undefined;

/** Creates the shared output channel. Call once, from `activate`. */
export function initializeLogger(): vscode.LogOutputChannel {
  channel ??= vscode.window.createOutputChannel('EnvShield', { log: true });
  return channel;
}

export function disposeLogger(): void {
  channel?.dispose();
  channel = undefined;
}

/**
 * Logs a message with every sensitive fragment removed.
 *
 * @param level Severity.
 * @param message Free text. Redacted before output.
 * @param details Optional structured context. Redacted before output.
 */
export function safeLog(level: LogLevel, message: string, ...details: unknown[]): void {
  const safeMessage = redactText(message);
  const safeDetails = details.map((detail) => redactUnknown(detail));
  const target = channel;
  if (!target) {
    return;
  }
  switch (level) {
    case 'debug':
      target.debug(safeMessage, ...safeDetails);
      break;
    case 'info':
      target.info(safeMessage, ...safeDetails);
      break;
    case 'warn':
      target.warn(safeMessage, ...safeDetails);
      break;
    case 'error':
      target.error(safeMessage, ...safeDetails);
      break;
  }
}

/** Logs an error without ever surfacing the payload that caused it. */
export function safeLogError(context: string, error: unknown): void {
  safeLog('error', `${redactText(context)}: ${redactUnknown(error)}`);
}

export const logger = {
  debug: (message: string, ...details: unknown[]): void => safeLog('debug', message, ...details),
  info: (message: string, ...details: unknown[]): void => safeLog('info', message, ...details),
  warn: (message: string, ...details: unknown[]): void => safeLog('warn', message, ...details),
  error: (message: string, ...details: unknown[]): void => safeLog('error', message, ...details),
  show: (): void => channel?.show(true),
};
