'use strict';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EnableResult, enable } from './enable';
import { FakeGist } from './fakeGist';
import { LocalFiles } from './localFiles';
import { SyncEngine } from './syncEngine';
import { CATEGORIES, Category, FirstSync, StoredState, SyncStatus } from './types';

const roots: string[] = [];

/** Deletes every temp folder the devices created; call from `after()`. */
export function cleanup(): void {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/** One machine: its own user-data folder, remembered state, passphrase and settings, talking to a shared fake Gist. */
export class Device {
  readonly root = fs.mkdtempSync(path.join(os.tmpdir(), 'null-sync-device-'));
  readonly userDir = path.join(this.root, 'User');
  readonly backupsDir = path.join(this.root, 'backups');
  /** Files (e.g. `keybindings.json`) that count as open with unsaved edits. */
  readonly dirty = new Set<string>();
  readonly engine: SyncEngine;
  enabled = true;
  /** Another window holds the cross-window lock. */
  locked = false;
  /** What an interactive run answers when asked to overwrite a file with unsaved edits. */
  overwrite = false;
  state: StoredState | undefined;
  passphrase: string | undefined;
  categories: Record<Category, boolean> = { settings: true, keybindings: true, snippets: true, extensions: true, activity: false };
  excluded = ['*.path', '*token*'];
  /** The extensions installed on this machine (enabled or not). */
  readonly installed = new Set<string>();
  /** Extension IDs whose install fails, like one that is not in the gallery. */
  readonly failing = new Set<string>();
  /** The on-disk extension list cannot be read. */
  manifestBroken = false;
  /** While set, an uninstall waits for it (a slow `workbench.extensions.uninstallExtension`). */
  uninstallGate: Promise<void> | undefined;
  readonly account = { id: 'acc', username: 'me' };
  private clock = 1;

  constructor(readonly gist: FakeGist) {
    roots.push(this.root);
    fs.mkdirSync(path.join(this.userDir, 'snippets'), { recursive: true });
    const files = new LocalFiles({
      userDir: this.userDir,
      backupsDir: this.backupsDir,
      now: () => this.clock++,
      isDirty: (p) => this.dirty.has(path.relative(this.userDir, p).split(path.sep).join('/')),
    });
    this.engine = new SyncEngine({
      enabled: () => this.enabled,
      categories: () => this.categories,
      excluded: () => this.excluded,
      accounts: async () => [this.account],
      token: async () => 'token',
      io: gist.io,
      files,
      passphrase: async () => this.passphrase,
      clearPassphrase: async () => { this.passphrase = undefined; },
      state: { get: () => this.state },
      setState: async (s) => { this.state = s; },
      lock: async () => (this.locked ? undefined : async () => undefined),
      now: () => this.clock++,
      confirmOverwrite: async () => this.overwrite,
      extensions: {
        installed: async () => (this.manifestBroken ? undefined : [...this.installed].sort()),
        install: async (id) => {
          if (this.failing.has(id)) return false;
          this.installed.add(id);
          return true;
        },
        uninstall: async (id) => {
          await this.uninstallGate;
          return this.installed.delete(id);
        },
      },
    });
  }

  get status(): SyncStatus {
    return this.engine.getStatus();
  }

  private abs(file: string): string {
    return path.join(this.userDir, ...file.split('/'));
  }
  write(file: string, text: string): void {
    fs.mkdirSync(path.dirname(this.abs(file)), { recursive: true });
    fs.writeFileSync(this.abs(file), text);
  }
  read(file: string): string | null {
    try {
      return fs.readFileSync(this.abs(file), 'utf8');
    } catch {
      return null;
    }
  }
  remove(file: string): void {
    fs.rmSync(this.abs(file), { force: true });
  }
  /** Backup files whose name starts with `prefix`, e.g. `keybindings.json.`. */
  backups(prefix: string): string[] {
    return fs.existsSync(this.backupsDir) ? fs.readdirSync(this.backupsDir).filter((n) => n.startsWith(prefix)) : [];
  }

  /** A background run (the timer / file watcher). */
  run(): Promise<void> {
    return this.engine.run({ interactive: false });
  }
  /** `Null: Sync Settings Now`. */
  syncNow(): Promise<void> {
    return this.engine.run({ interactive: true });
  }

  /** The Enable command: set this device up, then run once like the command does. */
  async enable(passphrase: string, firstSync: FirstSync | 'each' = 'each'): Promise<EnableResult> {
    const result = await enable(
      {
        accounts: async () => [this.account],
        token: async () => 'token',
        io: this.gist.io,
        categories: () => CATEGORIES.filter((c) => this.categories[c]),
        savePassphrase: async (p) => { this.passphrase = p; },
        setState: async (s) => { this.state = s; },
      },
      {
        chooseAccount: async (accounts) => accounts[0],
        consent: async () => true,
        newPassphrase: async () => passphrase,
        existingPassphrase: async () => passphrase,
        firstSync: async () => firstSync,
      },
    );
    if (result.ok) await this.engine.run({ interactive: true, firstSync: result.firstSync });
    return result;
  }
}
