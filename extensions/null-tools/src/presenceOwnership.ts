'use strict';

import * as fs from 'fs';
import * as path from 'path';

/**
 * Decides which Null IDE window owns the Discord presence.
 *
 * Every window runs its own extension host, so without coordination they all
 * publish and Discord flaps between projects. Ownership is claimed on focus and
 * recorded in a small file in globalStorage, which every window of the same
 * installation can see. Non-owners disconnect entirely and poll to take over if
 * the owner disappears.
 */

const DEFAULT_CLAIM_FILE = 'discord-presence-owner.json';
type LogFn = (message: string) => void;

interface OwnerClaim {
  pid: number;
  focusedAt: number;
  workspace?: string;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) { return false; }
  try {
    // Signal 0 performs the permission/existence check without sending anything.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export class PresenceOwnership {
  private readonly file: string | undefined;
  private lastLoggedOwner = -1;

  /** Without a storage directory (tests, older hosts) ownership is always granted. */
  constructor(storageDir: string | undefined, private readonly log: LogFn = () => undefined, claimFile: string = DEFAULT_CLAIM_FILE) {
    if (!storageDir) {
      this.file = undefined;
      return;
    }
    this.file = path.join(storageDir, claimFile);
    try {
      fs.mkdirSync(storageDir, { recursive: true });
    } catch {
      // A unusable storage dir degrades to single-window behaviour.
    }
  }

  /** Marks this window as the presence owner. Called when the window takes focus. */
  claim(workspace?: string): void {
    if (!this.file) { return; }

    const claim: OwnerClaim = { pid: process.pid, focusedAt: Date.now(), workspace };
    const temp = `${this.file}.${process.pid}.tmp`;
    try {
      // Write-then-rename so another window never observes a half-written claim.
      fs.writeFileSync(temp, JSON.stringify(claim), 'utf8');
      fs.renameSync(temp, this.file);
    } catch (err) {
      this.log(`Could not claim presence ownership: ${(err as Error).message}`);
      try { fs.unlinkSync(temp); } catch { /* nothing to clean up */ }
    }
  }

  /**
   * True when this window should publish. Takes over automatically if the
   * recorded owner is gone or the claim is unreadable.
   */
  isOwner(workspace?: string): boolean {
    if (!this.file) { return true; }

    const claim = this.read();

    if (!claim) {
      this.claim(workspace);
      return true;
    }
    if (claim.pid === process.pid) {
      return true;
    }
    if (!isProcessAlive(claim.pid)) {
      this.log(`Presence owner (pid ${claim.pid}) is gone — taking over.`);
      this.claim(workspace);
      return true;
    }

    if (this.lastLoggedOwner !== claim.pid) {
      this.lastLoggedOwner = claim.pid;
      const where = claim.workspace ? ` (${claim.workspace})` : '';
      this.log(`Another Null IDE window${where} owns the presence — staying quiet.`);
    }
    return false;
  }

  /** Gives up ownership so a sibling window can take over immediately. */
  release(): void {
    if (!this.file) { return; }
    const claim = this.read();
    if (!claim || claim.pid !== process.pid) { return; }
    try {
      fs.unlinkSync(this.file);
    } catch {
      // Already gone, or another window replaced it.
    }
  }

  private read(): OwnerClaim | undefined {
    if (!this.file) { return undefined; }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as OwnerClaim;
      return typeof parsed?.pid === 'number' ? parsed : undefined;
    } catch {
      // Missing or corrupt — treated as "no owner" by the caller.
      return undefined;
    }
  }
}
