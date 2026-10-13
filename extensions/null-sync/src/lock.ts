'use strict';

import * as fs from 'fs';
import * as path from 'path';

const STALE_MS = 120_000;

export type Release = () => Promise<void>;

/**
 * Several windows share one user-data folder and each runs the sync timers. A run takes this lock first and
 * skips when another window holds it. A lock older than `staleMs` belongs to a crashed window and is taken over.
 * Never throws. ponytail: a lock file with a stale timeout, not leader election; two windows taking over the same
 * stale lock in the same instant can both proceed, which the three-way plan tolerates (the second push is a no-op).
 */
export async function acquire(lockPath: string, now: () => number = Date.now, staleMs = STALE_MS): Promise<Release | undefined> {
  try {
    await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await fs.promises.open(lockPath, 'wx');
        await handle.writeFile(`${process.pid} ${now()}`);
        await handle.close();
        return () => fs.promises.rm(lockPath, { force: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return undefined;
        const stat = await fs.promises.stat(lockPath).catch(() => undefined);
        if (stat && now() - stat.mtimeMs < staleMs) return undefined;
        await fs.promises.rm(lockPath, { force: true });
      }
    }
  } catch {
    /* an unusable path means no sync this time */
  }
  return undefined;
}
