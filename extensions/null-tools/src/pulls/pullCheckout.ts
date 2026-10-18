'use strict';

import type { RunGit } from '../graph/gitRun';
import { PullSummary, pullBranch } from './pullModel';

export type CheckoutResult = { ok: true; branch: string } | { ok: false; message: string };

/**
 * Checks a PR out as `pullBranch(pull)`. `pull/<n>/head` is served by GitHub for fork PRs too.
 * An existing local branch is only ever fast-forwarded, so the user's own commits on it are never lost;
 * a dirty tree makes `git checkout` refuse by itself, and its message is returned as is.
 */
export async function checkoutPull(run: RunGit, pull: Pick<PullSummary, 'number' | 'headRef' | 'fork'>): Promise<CheckoutResult> {
  const n = pull.number;
  const branch = pullBranch(pull);
  try {
    await run(['fetch', 'origin', `pull/${n}/head`]);
    const exists = await run(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).then(() => true, () => false);
    if (!exists) {
      await run(['checkout', '-b', branch, 'FETCH_HEAD']);
    } else {
      await run(['checkout', branch]);
      await run(['merge', '--ff-only', 'FETCH_HEAD']);
    }
    return { ok: true, branch };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
