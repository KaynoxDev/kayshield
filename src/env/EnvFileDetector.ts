/**
 * Decides whether a file is an environment file EnvShield should handle, and
 * whether it should be treated as a public template.
 *
 * Pure module (filename-based only): no `vscode` import, no filesystem access.
 * Workspace discovery lives in the view layer, which owns the `vscode` API.
 */

import { matchesAnyGlob } from '../utils/glob';

export const DEFAULT_FILE_PATTERNS: readonly string[] = ['.env*', '*.env'];

/** Suffixes that conventionally hold placeholders rather than real secrets. */
const TEMPLATE_SUFFIXES = ['.example', '.sample', '.template', '.dist', '.defaults'];

export interface EnvFileClassification {
  readonly fileName: string;
  /** True when the file matches the configured environment file patterns. */
  readonly isEnvFile: boolean;
  /** True for `.env.example` and friends. */
  readonly isTemplate: boolean;
  /**
   * True when values must be treated as public. A template is public unless the
   * user opted into protecting templates too.
   */
  readonly treatAsPublic: boolean;
}

export interface ClassifyOptions {
  readonly filePatterns?: readonly string[];
  readonly protectEnvExample?: boolean;
}

/** Extracts the file name from a path or URI-like string. */
export function baseName(pathOrUri: string): string {
  const normalized = pathOrUri.replace(/[?#].*$/, '').replace(/\\/g, '/');
  const trimmed = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  const index = trimmed.lastIndexOf('/');
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

export function isTemplateFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return TEMPLATE_SUFFIXES.some((suffix) => lower.endsWith(suffix) || lower.includes(`${suffix}.`));
}

/** Classifies a path against the configured patterns. */
export function classifyEnvFile(
  pathOrUri: string,
  options: ClassifyOptions = {},
): EnvFileClassification {
  const fileName = baseName(pathOrUri);
  const patterns = options.filePatterns ?? DEFAULT_FILE_PATTERNS;
  const isEnvFile = matchesAnyGlob(fileName, patterns);
  const isTemplate = isTemplateFileName(fileName);
  return {
    fileName,
    isEnvFile,
    isTemplate,
    treatAsPublic: isTemplate && options.protectEnvExample !== true,
  };
}

/** Convenience predicate used by commands and menus. */
export function isEnvFile(pathOrUri: string, patterns?: readonly string[]): boolean {
  return classifyEnvFile(pathOrUri, patterns ? { filePatterns: patterns } : {}).isEnvFile;
}
