'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { emptyDocUri } from '../graph/graphDiff';
import { DocRef, PULL_SCHEME, docQuery } from './pullDocs';
import { PullDetail, PullFile, leftPath } from './pullModel';

export function pullDocUri(ref: DocRef): vscode.Uri {
  return vscode.Uri.from({ scheme: PULL_SCHEME, path: `/${ref.path}`, query: docQuery(ref) });
}

/** The document for one side of `filePath`. Diffs and comment threads both build their URIs here, so they always match. */
export function sideUri(detail: PullDetail, filePath: string, side: 'LEFT' | 'RIGHT'): vscode.Uri {
  return pullDocUri({
    ...detail.repo,
    pull: detail.pull.number,
    path: side === 'LEFT' ? leftPath(detail.files, filePath) : filePath,
    sha: side === 'LEFT' ? detail.mergeBase : detail.pull.headSha,
    head: detail.pull.headSha,
    side,
  });
}

export async function openPullFileDiff(detail: PullDetail, file: PullFile): Promise<void> {
  const left = file.status === 'added' ? emptyDocUri(file.path) : sideUri(detail, file.path, 'LEFT');
  const right = file.status === 'removed' ? emptyDocUri(file.path) : sideUri(detail, file.path, 'RIGHT');
  await vscode.commands.executeCommand('vscode.diff', left, right, `${path.basename(file.path)} (#${detail.pull.number})`);
}
