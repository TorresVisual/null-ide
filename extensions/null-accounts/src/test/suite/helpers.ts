'use strict';

import * as assert from 'assert';
import { execFileSync } from 'child_process';

/** Output of `git <args>` in `cwd`; '' when git exits non-zero (an unset config key). */
export function git(cwd: string, ...args: string[]): string {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); } catch { return ''; }
}

/** Wiring runs asynchronously after a bind or a removal, so poll instead of reading once. */
export async function waitFor(what: string, done: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (done()) { return; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(`timed out waiting for ${what}`);
}
