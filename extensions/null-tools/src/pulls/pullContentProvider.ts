'use strict';

import * as vscode from 'vscode';
import { TooLargeError, fetchRepoFile } from '../github/githubApi';
import { getGithubSession } from '../github/githubAuth';
import { MAX_SIDE_BYTES, PLACEHOLDER, decodeBlob, parseDocQuery } from './pullDocs';

/** Serves `null-pr:` documents: a file as it was at the merge base or at the PR head, straight from GitHub. */
export class PullContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const ref = parseDocQuery(uri.path, uri.query);
    if (!ref) return '';
    const session = await getGithubSession(false);
    try {
      const { bytes } = await fetchRepoFile(ref.owner, ref.repo, ref.sha, ref.path, session?.accessToken ?? null, MAX_SIDE_BYTES);
      return decodeBlob(bytes);
    } catch (err) {
      if (err instanceof TooLargeError) return PLACEHOLDER;
      throw err;
    }
  }
}
