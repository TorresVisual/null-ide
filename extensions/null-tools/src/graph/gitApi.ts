'use strict';

import * as path from 'path';
import * as vscode from 'vscode';

/** The slice of the built-in vscode.git API (v1) the graph uses. */
export interface GitApi {
  repositories: Array<{ rootUri: vscode.Uri; state: { onDidChange: vscode.Event<void> } }>;
  onDidOpenRepository: vscode.Event<unknown>;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

export async function getGitApi(): Promise<GitApi> {
  const extension = vscode.extensions.getExtension('vscode.git');
  if (!extension) throw new Error('The built-in git extension was not found.');
  const exports = extension.isActive ? extension.exports : await extension.activate();
  return exports.getAPI(1) as GitApi;
}

const same = (a: string, b: string): boolean => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

export function findRepository(api: GitApi, root: string): GitApi['repositories'][number] | undefined {
  return api.repositories.find((repo) => same(repo.rootUri.fsPath, root));
}
