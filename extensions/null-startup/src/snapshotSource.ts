'use strict';

import * as vscode from 'vscode';
import { parseSnapshot } from './snapshot';
import { Snapshot } from './types';

export const SNAPSHOT_COMMAND = '_null.startup.snapshot';
const TIMEOUT_MS = 10_000;

/** Calls the internal command added by patch 010; on a build without it, logs and returns undefined. */
export async function takeSnapshot(log: (message: string) => void): Promise<Snapshot | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const raw = await Promise.race([
      Promise.resolve(vscode.commands.executeCommand<unknown>(SNAPSHOT_COMMAND)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), TIMEOUT_MS);
      }),
    ]);
    const snapshot = parseSnapshot(raw);
    if (!snapshot) log('startup snapshot had an unexpected shape; ignored');
    return snapshot;
  } catch (err) {
    log(`startup snapshot unavailable (needs a Null IDE build with patch 010): ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
