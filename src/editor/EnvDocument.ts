/**
 * A `vscode.TextDocument` seen as a structured environment file.
 *
 * The document on disk stays a plain `.env` at all times. This class only adds
 * a parsed view of it, cached per document version so that typing does not
 * re-parse on every keystroke, and a set of surgical edit operations.
 */

import * as vscode from 'vscode';
import { parseEnv } from '../env/EnvParser';
import {
  applyEdits,
  buildAppendEdit,
  buildDeleteEdit,
  buildRenameEdit,
  buildValueEdit,
  type TextEditDescriptor,
} from '../env/EnvSerializer';
import { buildVariables, type BuildContext } from '../env/EnvVariable';
import { classifyEnvFile } from '../env/EnvFileDetector';
import type { EnvDocumentAst, EnvironmentVariable, EnvVariableNode, TextRange } from '../types';

function toRange(range: TextRange): vscode.Range {
  return new vscode.Range(range.startLine, range.startColumn, range.endLine, range.endColumn);
}

export class EnvDocument {
  private cachedAst: EnvDocumentAst | undefined;
  private cachedVersion = -1;

  constructor(private readonly document: vscode.TextDocument) {}

  get uri(): vscode.Uri {
    return this.document.uri;
  }

  get fileName(): string {
    return this.document.fileName;
  }

  get textDocument(): vscode.TextDocument {
    return this.document;
  }

  /** Parsed view, recomputed only when the document version changed. */
  get ast(): EnvDocumentAst {
    if (this.cachedAst === undefined || this.cachedVersion !== this.document.version) {
      this.cachedAst = parseEnv(this.document.getText());
      this.cachedVersion = this.document.version;
    }
    return this.cachedAst;
  }

  /** True when this file is a template such as `.env.example`. */
  isTemplate(protectEnvExample: boolean): boolean {
    return classifyEnvFile(this.document.uri.path, { protectEnvExample }).treatAsPublic;
  }

  node(variableId: string): EnvVariableNode | undefined {
    return this.ast.variables.find((variable) => variable.id === variableId);
  }

  variables(context: BuildContext): EnvironmentVariable[] {
    return buildVariables(this.ast, context);
  }

  /** Replaces one value, leaving every other byte of the file untouched. */
  async setValue(variableId: string, newValue: string): Promise<boolean> {
    const node = this.node(variableId);
    if (!node) {
      return false;
    }
    return this.applyEdit(buildValueEdit(node, newValue));
  }

  async renameVariable(variableId: string, newKey: string): Promise<boolean> {
    const node = this.node(variableId);
    if (!node) {
      return false;
    }
    return this.applyEdit(buildRenameEdit(node, newKey));
  }

  async deleteVariable(variableId: string): Promise<boolean> {
    const node = this.node(variableId);
    if (!node) {
      return false;
    }
    return this.applyEdit(buildDeleteEdit(node));
  }

  async addVariable(key: string, value: string): Promise<boolean> {
    return this.applyEdit(buildAppendEdit(this.ast, key, value));
  }

  /** Text the document would contain after `edits`. Used by unit tests. */
  preview(edits: readonly TextEditDescriptor[]): string {
    return applyEdits(this.document.getText(), edits);
  }

  private async applyEdit(descriptor: TextEditDescriptor): Promise<boolean> {
    const edit = new vscode.WorkspaceEdit();
    const range = toRange(descriptor.range);
    // A delete range may point one line past the end on the last line.
    const clamped = this.document.validateRange(range);
    edit.replace(this.document.uri, clamped, descriptor.newText);
    return vscode.workspace.applyEdit(edit);
  }
}
