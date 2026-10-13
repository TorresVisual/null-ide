'use strict';

import * as crypto from 'crypto';
import { open, seal, unlock } from './cryptoBox';
import { mergeExtensions, parseIds } from './extensionSet';
import { Failure, GistIo, GistStore, Revision, createGistStore } from './gistStore';
import { EXTENSIONS_REMOTE, CORE_FILES, MANIFEST, SETTINGS, categoryOf, fileOfRemoteName, isDeletable, remoteNameOf } from './layout';
import { reapplyExcluded, stripExcluded } from './settingsFilter';
import { planFile } from './syncPlan';
import { Base, CATEGORIES, Category, Conflict, FirstSync, StoredState, SyncAccount, SyncStatus, Value } from './types';

/** Gist files over 1 MB are truncated by the API; stay well below. */
const MAX_FILE_BYTES = 900_000;

export interface LocalFilesPort {
  list(categories: Category[]): Promise<Record<string, string>>;
  read(file: string): Promise<string | null>;
  write(file: string, content: string | null): Promise<void>;
  isDirty(file: string): boolean;
}

/** Reads and changes the installed extensions on this machine; `installed()` is `undefined` if it cannot be read. */
export interface ExtensionHost {
  installed(): Promise<string[] | undefined>;
  /** True only if the extension is installed afterwards. */
  install(id: string): Promise<boolean>;
  /** True only if the extension is gone afterwards. */
  uninstall(id: string): Promise<boolean>;
}

export interface EngineDeps {
  /** The `null-sync.enabled` switch. */
  enabled(): boolean;
  categories(): Record<Category, boolean>;
  excluded(): string[];
  accounts(): Promise<SyncAccount[]>;
  /** `interactive: false` must never show UI. */
  token(accountId: string, interactive: boolean): Promise<string | undefined>;
  io: GistIo;
  files: LocalFilesPort;
  passphrase(): Promise<string | undefined>;
  clearPassphrase(): Promise<void>;
  state: { get(): StoredState | undefined };
  setState(state: StoredState | undefined): Promise<void>;
  /** The cross-window lock: a release function, or `undefined` if another window is syncing. */
  lock(): Promise<(() => Promise<void>) | undefined>;
  now(): number;
  /** Only called in interactive runs, for a file with unsaved edits. */
  confirmOverwrite?(file: string): Promise<boolean>;
  extensions?: ExtensionHost;
}

export interface RunOptions {
  interactive: boolean;
  /** How the Enable flow resolved first-sync conflicts, applied to this run's conflicts that have no base yet. */
  firstSync?: FirstSync;
}

const hash = (text: string | null): Value => (text === null ? null : crypto.createHash('sha256').update(text).digest('hex'));
const enabledCategories = (c: Record<Category, boolean>): Category[] => CATEGORIES.filter((category) => c[category]);
const tooLarge = (content: string | null): boolean => content !== null && Buffer.byteLength(content) > MAX_FILE_BYTES;

const CLEARED: Partial<SyncStatus> = {
  conflicts: [],
  pending: [],
  pendingInstalls: [],
  pendingRemovals: [],
  lastSyncedAt: undefined,
  message: undefined,
};

interface Conn {
  st: StoredState;
  store: GistStore;
  key: Buffer;
  /** Gist file name → stored text, as read at the start of this run. */
  files: Record<string, string>;
}

/** One synced file as seen from both sides. */
interface Inspected {
  file: string;
  name: string;
  /** What is on disk (`null` = no file). */
  raw: string | null;
  /** What would be uploaded: `raw`, with the excluded settings removed for `settings.json`. */
  content: string | null;
  /** The decrypted remote text (`null` = no such remote file). */
  plain: string | null;
  lv: Value;
  rv: Value;
}

export class SyncEngine {
  private status: SyncStatus;
  private readonly listeners = new Set<() => void>();
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: EngineDeps) {
    this.status = { conflicts: [], pending: [], pendingInstalls: [], pendingRemovals: [], state: d.enabled() ? 'idle' : 'disabled' };
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  }

  private set(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Runs one sync. Never rejects. A background run (`interactive: false`) never prompts and skips quietly when another window is syncing. */
  run(options: RunOptions): Promise<void> {
    if (!this.d.enabled()) {
      this.set({ ...CLEARED, state: 'disabled' });
      return Promise.resolve();
    }
    return this.serialized(async () => {
      this.set({ state: 'syncing' });
      const conn = await this.connect(options.interactive);
      if (conn) await this.sync(conn, options);
    }, !options.interactive);
  }

  /** `idle` or `needsAttention`, from what is still outstanding. */
  private settle(): void {
    const s = this.status;
    const outstanding = s.conflicts.length + s.pending.length + s.pendingInstalls.length + s.pendingRemovals.length;
    this.set({ state: outstanding > 0 ? 'needsAttention' : 'idle', message: undefined });
  }

  /** `mine` uploads this device's file; `theirs` backs it up and applies the remote one. */
  resolve(file: string, side: 'mine' | 'theirs'): Promise<void> {
    return this.serialized(async () => {
      const c = await this.connect(true);
      if (!c) return;
      const i = this.inspect(c, file, await this.d.files.read(file));
      if (typeof i === 'string') {
        this.set({ state: 'error', message: i });
        return;
      }
      const base = { ...c.st.base };
      if (side === 'mine') {
        if (tooLarge(i.content)) {
          this.set({ state: 'error', message: `${file} is too large to sync.` });
          return;
        }
        const updated = await c.store.update(c.st.gistId, { [i.name]: i.content === null ? null : seal(c.key, i.name, i.content) });
        if (!updated.ok) {
          this.failed(updated);
          return;
        }
        base[file] = { local: i.lv, remote: i.lv };
      } else {
        const applied = await this.applyPull(i);
        if (typeof applied === 'string') {
          this.set({ state: 'error', message: applied });
          return;
        }
        base[file] = applied.base;
      }
      await this.d.setState({ ...c.st, base });
      this.set({ conflicts: this.status.conflicts.filter((x) => x.file !== file) });
      this.settle();
    }, false);
  }

  /** The decrypted remote text of a file, for a diff; `undefined` if there is none. */
  async previewRemote(file: string): Promise<string | undefined> {
    await this.tail;
    const c = await this.connect(true);
    const i = c && this.inspect(c, file, null);
    return typeof i === 'object' ? (i.plain ?? undefined) : undefined;
  }

  /** The Gist's revisions, newest first; `undefined` (with the status set) if they cannot be read. */
  async revisions(): Promise<Revision[] | undefined> {
    await this.tail;
    const c = await this.connect(true);
    if (!c) return undefined;
    const revisions = await c.store.revisions(c.st.gistId);
    return revisions.ok ? revisions.value : this.failed(revisions);
  }

  /** Applies an earlier revision locally and uploads it as a new revision, so every other device rolls back too. */
  restore(revision: string): Promise<void> {
    return this.serialized(async () => {
      const c = await this.connect(true);
      if (!c) return;
      const snapshot = await c.store.readRevision(c.st.gistId, revision);
      if (!snapshot.ok) {
        if (snapshot.kind === 'notFound') this.set({ state: 'error', message: 'That revision no longer exists.' });
        else this.failed(snapshot);
        return;
      }
      const categories = enabledCategories(this.d.categories());
      const problems: string[] = [];
      const base = { ...c.st.base };
      const changes: Record<string, string | null> = {};
      const pushed: Record<string, Base> = {};
      for (const [name, encrypted] of Object.entries(snapshot.value.files)) {
        const file = fileOfRemoteName(name);
        if (file === undefined || !categories.includes(categoryOf(file))) continue;
        const plain = open(c.key, name, encrypted);
        if (plain === undefined) {
          problems.push(`Could not decrypt ${name} in that revision.`);
          continue;
        }
        const raw = await this.d.files.read(file);
        const applied = await this.applyPull({ file, name, raw, content: plain, plain, lv: hash(plain), rv: hash(plain) });
        if (typeof applied === 'string') {
          problems.push(applied);
          continue;
        }
        const uploaded = applied.uploaded ?? plain;
        changes[name] = seal(c.key, name, uploaded);
        pushed[file] = { local: hash(uploaded), remote: hash(uploaded) };
      }
      if (Object.keys(changes).length > 0) {
        const updated = await c.store.update(c.st.gistId, changes);
        if (!updated.ok) {
          this.failed(updated);
          return;
        }
        Object.assign(base, pushed);
      }
      await this.d.setState({ ...c.st, base });
      this.set({ conflicts: this.status.conflicts.filter((x) => !(x.file in pushed)) });
      if (problems.length > 0) this.set({ state: 'error', message: problems.join(' ') });
      else this.settle();
    }, false);
  }

  /** Forgets this device (state and passphrase); optionally deletes the cloud copy first. Local files are never touched. */
  async stop(deleteGist: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
    await this.tail;
    const st = this.d.state.get();
    if (deleteGist && st) {
      const account = (await this.d.accounts()).find((a) => a.id === st.accountId);
      const token = account && (await this.d.token(account.id, true));
      if (!token) return { ok: false, message: 'Could not get a GitHub token to delete the Gist.' };
      const removed = await createGistStore(this.d.io, token).remove(st.gistId);
      if (!removed.ok && removed.kind !== 'notFound') return { ok: false, message: removed.message };
    }
    await this.d.setState(undefined);
    await this.d.clearPassphrase();
    this.set({ ...CLEARED, state: 'disabled' });
    return { ok: true };
  }

  /** One task at a time, under the cross-window lock. Never rejects. */
  private serialized(task: () => Promise<void>, quiet: boolean): Promise<void> {
    const next = this.tail.then(async () => {
      try {
        const release = await this.d.lock();
        if (!release) {
          if (!quiet) this.set({ message: 'Another window is syncing. Try again in a moment.' });
          return;
        }
        try {
          await task();
        } finally {
          await release();
        }
      } catch (err) {
        this.set({ state: 'error', message: `Sync failed (${err instanceof Error ? err.message : String(err)}).` });
      }
    });
    this.tail = next;
    return next;
  }

  /** Sets the status for a failed Gist call and returns `undefined` so callers can `return this.failed(...)`. */
  private failed(failure: Failure): undefined {
    this.set({
      state: failure.kind === 'offline' ? 'offline' : failure.kind === 'error' ? 'error' : 'signedOut',
      message:
        failure.kind === 'notFound'
          ? 'The sync Gist no longer exists. Run "Null: Enable Settings Sync" to create a new one.'
          : failure.message,
    });
    return undefined;
  }

  /** Account, token, passphrase and the current remote files; sets the status and returns `undefined` if any is missing. */
  private async connect(interactive: boolean): Promise<Conn | undefined> {
    const { d } = this;
    const st = d.state.get();
    const passphrase = await d.passphrase();
    const account = st && (await d.accounts()).find((a) => a.id === st.accountId);
    if (!st || !account || !passphrase) {
      this.set({ state: 'signedOut', message: 'Run "Null: Enable Settings Sync" to set up sync on this device.' });
      return undefined;
    }
    const token = await d.token(account.id, interactive);
    if (!token) {
      this.set({ state: 'signedOut', message: `Sign in to @${account.username} in Null Accounts (with the gist scope) to sync.` });
      return undefined;
    }
    const store = createGistStore(d.io, token);
    const read = await store.read(st.gistId);
    if (!read.ok) return this.failed(read);
    const key = await unlock(passphrase, read.value.files[MANIFEST]);
    if (!key) {
      this.set({ state: 'error', message: 'The saved passphrase does not match this sync store. Run "Null: Enable Settings Sync" again.' });
      return undefined;
    }
    return { st, store, key, files: read.value.files };
  }

  /** Both sides of one file, or a message if either cannot be used. */
  private inspect(c: Conn, file: string, raw: string | null): Inspected | string {
    const name = remoteNameOf(file);
    let content = raw;
    if (file === SETTINGS && raw !== null) {
      const stripped = stripExcluded(raw, this.d.excluded());
      if (stripped === undefined) return 'settings.json is not valid JSON, so it was not synced.';
      content = stripped;
    }
    let plain: string | null = null;
    const encrypted = c.files[name];
    if (encrypted !== undefined) {
      const opened = open(c.key, name, encrypted);
      if (opened === undefined) return `Could not decrypt ${name}; it was left alone.`;
      plain = opened;
    }
    return { file, name, raw, content, plain, lv: hash(content), rv: hash(plain) };
  }

  /** Writes the remote version locally (back-up first). `uploaded` is what this device would now upload for the file. */
  private async applyPull(i: Inspected): Promise<{ base: Base; uploaded: string | null } | string> {
    let text = i.plain;
    if (i.file === SETTINGS && i.plain !== null) {
      const merged = reapplyExcluded(i.plain, i.raw, this.d.excluded());
      if (merged === undefined) return 'The synced settings.json is not valid JSON and was not applied.';
      text = merged;
    }
    await this.d.files.write(i.file, text);
    const uploaded = i.file === SETTINGS && text !== null ? (stripExcluded(text, this.d.excluded()) ?? text) : text;
    return { base: { local: hash(uploaded), remote: i.rv }, uploaded };
  }

  private async sync(c: Conn, { interactive, firstSync }: RunOptions): Promise<void> {
    const { d } = this;
    const categories = enabledCategories(d.categories());
    const raws = await d.files.list(categories);
    const names = new Set(Object.keys(raws));
    for (const file of CORE_FILES) {
      if (categories.includes(categoryOf(file))) names.add(file);
    }
    for (const name of Object.keys(c.files)) {
      const file = fileOfRemoteName(name);
      if (file !== undefined && categories.includes(categoryOf(file))) names.add(file);
    }

    const problems: string[] = [];
    const conflicts: Conflict[] = [];
    const pending: string[] = [];
    const base = { ...c.st.base };
    const changes: Record<string, string | null> = {};
    const pushed: Record<string, Base> = {};

    for (const file of [...names].sort()) {
      const i = this.inspect(c, file, raws[file] ?? null);
      if (typeof i === 'string') {
        problems.push(i);
        continue;
      }
      const prior = c.st.base[file];
      let action = planFile(i.lv, i.rv, prior, isDeletable(file));
      if (action === 'conflict' && prior === undefined && firstSync) action = firstSync === 'cloud' ? 'pull' : 'push';

      switch (action) {
        case 'none':
          base[file] = { local: i.lv, remote: i.rv };
          break;
        case 'conflict':
          conflicts.push({ file, category: categoryOf(file) });
          break;
        case 'push':
          if (tooLarge(i.content)) {
            problems.push(`${file} is too large to sync.`);
            break;
          }
          changes[i.name] = i.content === null ? null : seal(c.key, i.name, i.content);
          pushed[file] = { local: i.lv, remote: i.lv };
          break;
        case 'pull': {
          if (d.files.isDirty(file) && !(interactive && d.confirmOverwrite && (await d.confirmOverwrite(file)))) {
            pending.push(file);
            break;
          }
          const applied = await this.applyPull(i);
          if (typeof applied === 'string') problems.push(applied);
          else base[file] = applied.base;
          break;
        }
      }
    }

    let extensionsBase = c.st.extensionsBase;
    let pendingInstalls: string[] = [];
    let pendingRemovals: string[] = [];
    if (categories.includes('extensions') && d.extensions) {
      const merged = await this.syncExtensions(c, d.extensions, interactive, problems);
      if (merged) {
        pendingInstalls = merged.pendingInstalls;
        pendingRemovals = merged.pendingRemovals;
        extensionsBase = merged.nextBase;
        if (merged.push) changes[EXTENSIONS_REMOTE] = seal(c.key, EXTENSIONS_REMOTE, JSON.stringify(merged.push));
      }
    }

    if (Object.keys(changes).length > 0) {
      const updated = await c.store.update(c.st.gistId, changes);
      if (!updated.ok) {
        // Pulls already happened, so remember them; the extension base stays put until the upload works.
        await d.setState({ ...c.st, base });
        this.failed(updated);
        this.set({ conflicts, pending, pendingInstalls, pendingRemovals });
        return;
      }
      Object.assign(base, pushed);
    }

    const lastSyncedAt = d.now();
    await d.setState({ ...c.st, base, extensionsBase, lastSyncedAt });
    const outstanding = conflicts.length + pending.length + pendingInstalls.length + pendingRemovals.length;
    this.set({
      state: problems.length > 0 ? 'error' : outstanding > 0 ? 'needsAttention' : 'idle',
      message: problems.length > 0 ? problems.join(' ') : undefined,
      lastSyncedAt,
      conflicts,
      pending,
      pendingInstalls,
      pendingRemovals,
    });
  }

  /**
   * Merges the installed-extension list with the remote one. Only an interactive run installs; removals are only ever
   * reported. `undefined` (with a message in `problems`) when either list cannot be read, so nothing is changed.
   */
  private async syncExtensions(c: Conn, host: ExtensionHost, interactive: boolean, problems: string[]) {
    let remote: string[] | null = null;
    const encrypted = c.files[EXTENSIONS_REMOTE];
    if (encrypted !== undefined) {
      const plain = open(c.key, EXTENSIONS_REMOTE, encrypted);
      const ids = plain === undefined ? undefined : parseIds(plain);
      if (ids === undefined) {
        problems.push(`Could not read ${EXTENSIONS_REMOTE}; the extension list was left alone.`);
        return undefined;
      }
      remote = ids;
    }
    const installed = await host.installed();
    if (installed === undefined) {
      problems.push('Could not read the installed extensions; the extension list was not synced.');
      return undefined;
    }

    let local = installed;
    let merge = mergeExtensions(local, remote, c.st.extensionsBase);
    if (interactive && merge.install.length > 0) {
      for (const id of merge.install) {
        if (await host.install(id)) local = [...local, id];
        else problems.push(`Could not install ${id}.`);
      }
      merge = mergeExtensions(local, remote, c.st.extensionsBase);
    }
    return { pendingInstalls: merge.install, pendingRemovals: merge.notifyRemoved, push: merge.push, nextBase: merge.nextBase };
  }

  /** Uninstalls an extension that was removed on another device, and stops reporting it. */
  async uninstallRemoved(id: string): Promise<void> {
    await this.tail;
    const host = this.d.extensions;
    const st = this.d.state.get();
    if (!host || !st || !this.status.pendingRemovals.includes(id)) return;
    if (!(await host.uninstall(id))) {
      this.set({ state: 'error', message: `Could not uninstall ${id}.` });
      return;
    }
    await this.d.setState({ ...st, extensionsBase: (st.extensionsBase ?? []).filter((x) => x !== id) });
    this.set({ pendingRemovals: this.status.pendingRemovals.filter((x) => x !== id) });
    this.settle();
  }
}
