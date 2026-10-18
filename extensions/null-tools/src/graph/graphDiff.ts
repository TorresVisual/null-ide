/// <reference path="./protocol.ts" />
'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { getGitApi } from './gitApi';

const EMPTY_SCHEME = 'null-graph-empty';

/** Serves an empty document for the missing side of an added, deleted or root-commit diff. */
export function registerEmptyDocument(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(EMPTY_SCHEME, { provideTextDocumentContent: () => '' }),
  );
}

/** URI of the empty document standing in for the missing side of an added or deleted file. */
export function emptyDocUri(filePath: string): vscode.Uri {
  return vscode.Uri.from({ scheme: EMPTY_SCHEME, path: `/${filePath}` });
}

/** Opens a native diff of `file` between `parent` and `sha` (no parent = root commit). */
export async function openFileDiff(root: string, sha: string, parent: string | undefined, file: GraphFile): Promise<void> {
  const api = await getGitApi();
  const empty = emptyDocUri(file.path);
  const left = !parent || file.status === 'A'
    ? empty
    : api.toGitUri(vscode.Uri.file(path.join(root, file.oldPath ?? file.path)), parent);
  const right = file.status === 'D' ? empty : api.toGitUri(vscode.Uri.file(path.join(root, file.path)), sha);
  const title = `${path.basename(file.path)} (${parent ? parent.slice(0, 7) : 'empty'} ↔ ${sha.slice(0, 7)})`;
  await vscode.commands.executeCommand('vscode.diff', left, right, title);
}
