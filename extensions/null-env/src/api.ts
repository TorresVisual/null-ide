import type * as vscode from 'vscode';
import type { DetectedProject } from './detect';
import type { Finding } from './types';

/** Exports of `null.null-env`, for the workspace-side built-ins that depend on it. */
export interface NullEnvApi {
  getFindings(): Finding[];
  onDidChange: vscode.Event<void>;
  detectProjects(folderPath: string): DetectedProject[];
  findExecutable(name: string): string | null;
  findRustfmtPath(configuredPath?: string, extensionPath?: string): string | null;
  findClangFormatPath(configuredPath?: string, extensionPath?: string): string | null;
  ensureDebugType(type: string): Promise<boolean>;
}
