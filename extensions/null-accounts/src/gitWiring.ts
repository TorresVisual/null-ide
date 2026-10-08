'use strict';

import { MetadataStore } from './accountStore';
import { GIT_UNAVAILABLE, GitRun } from './git';
import { planFor, sshKeyFile, WiringPlan } from './gitPlan';
import { serial } from './serial';
import { Account } from './types';

export const WIRING_KEY = 'null-accounts.gitWiring';

/** One config key we wrote, and what was there before (`null` = it was unset). */
interface WrittenEntry { key: string; value: string; previous: string | null }
/** What we wrote into one folder's repo, so unbinding undoes exactly that. */
interface WiringRecord { accountId: string; entries: WrittenEntry[] }

export type SkipReason = 'folder-missing' | 'git-missing' | 'not-a-repo' | 'ssh-key-missing' | 'config-failed';

export type WireOutcome =
  | { folder: string; status: 'unchanged' | 'wired' | 'cleared' }
  | { folder: string; status: 'skipped'; reason: SkipReason; detail?: string };

export interface WiringDeps {
  meta: MetadataStore;
  git: GitRun;
  /** [folder key, account id] pairs (`ProjectBinding.entries`). */
  bindings: { entries(): [string, string][] };
  accounts: { get(id: string): Account | undefined };
  exists(path: string): boolean;
  home: string;
}

const stripNewline = (s: string): string => s.replace(/\r?\n$/, '');
const INSIDE_REPO = ['rev-parse', '--is-inside-work-tree'];

const sameConfig = (entries: readonly WrittenEntry[], plan: WiringPlan): boolean =>
  entries.length === plan.config.length && plan.config.every((c, i) => entries[i].key === c.key && entries[i].value === c.value);

const isRecord = (v: unknown): v is WiringRecord =>
  typeof v === 'object' && v !== null && typeof (v as WiringRecord).accountId === 'string' && Array.isArray((v as WiringRecord).entries);

/**
 * Applies each bound folder's account to its repo-local git config (`git config --local` only; global and
 * system config are never touched) and takes it back out when the folder is unbound.
 */
export class GitWiring {
  private readonly queue = serial();

  constructor(private readonly deps: WiringDeps) {}

  /** Brings every bound folder, and every folder we wired earlier, in line with the current bindings. Safe to call often. */
  reconcile(): Promise<WireOutcome[]> {
    return this.queue(async () => {
      const bound = new Map(this.deps.bindings.entries());
      const folders = new Set([...bound.keys(), ...Object.keys(this.records())]);
      const outcomes: WireOutcome[] = [];
      for (const folder of folders) {
        outcomes.push(await this.syncFolder(folder, bound.get(folder)));
      }
      return outcomes;
    });
  }

  private async syncFolder(folder: string, accountId: string | undefined): Promise<WireOutcome> {
    const old = this.records()[folder];
    const account = accountId === undefined ? undefined : this.deps.accounts.get(accountId);
    if (!account) {
      if (!old) { return { folder, status: 'unchanged' }; }
      return (await this.release(folder, old))
        ? { folder, status: 'cleared' }
        : { folder, status: 'skipped', reason: 'git-missing' };
    }

    const plan = planFor(account, this.deps.home);
    if (old && old.accountId === account.id && sameConfig(old.entries, plan)) { return { folder, status: 'unchanged' }; }

    // A skipped folder must not keep the previous account's identity.
    const skip = async (reason: SkipReason, detail?: string): Promise<WireOutcome> => {
      if (old && old.accountId !== account.id) { await this.release(folder, old); }
      return { folder, status: 'skipped', reason, detail };
    };
    // Checked first: git reports a folder that doesn't exist exactly like git not being installed.
    if (!this.deps.exists(folder)) { return skip('folder-missing'); }
    if (account.authMethod === 'ssh') {
      const keyFile = sshKeyFile(account, this.deps.home);
      if (!this.deps.exists(keyFile)) { return skip('ssh-key-missing', keyFile); }
    }
    const probe = await this.deps.git(folder, INSIDE_REPO);
    if (probe.code === GIT_UNAVAILABLE) { return skip('git-missing'); }
    if (probe.code !== 0) { return skip('not-a-repo', probe.stderr.trim().split(/\r?\n/)[0]); }

    if (old) { await this.restore(folder, old); }
    const entries: WrittenEntry[] = [];
    for (const { key, value } of plan.config) {
      const current = await this.deps.git(folder, ['config', '--local', '--get', key]);
      // ponytail: a key set several times collapses to one value here; `previous` keeps only the last.
      const previous = current.code === 0 ? stripNewline(current.stdout) : null;
      const set = await this.deps.git(folder, ['config', '--local', '--replace-all', key, value]);
      if (set.code !== 0) {
        await this.save(folder, { accountId: account.id, entries }); // keep what did land, so it can still be undone
        return { folder, status: 'skipped', reason: 'config-failed', detail: set.stderr.trim() };
      }
      entries.push({ key, value, previous });
    }
    // ponytail: a crash between the writes above and this save leaves keys with no record; they just stay until the next bind overwrites them.
    await this.save(folder, { accountId: account.id, entries });
    return { folder, status: 'wired' };
  }

  /** Puts back what each entry replaced, but only where the value is still the one we wrote: a hand edit since then is the user's. */
  private async restore(folder: string, record: WiringRecord): Promise<boolean> {
    for (const entry of [...record.entries].reverse()) {
      const current = await this.deps.git(folder, ['config', '--local', '--get', entry.key]);
      if (current.code === GIT_UNAVAILABLE) { return false; }
      if (current.code !== 0 || stripNewline(current.stdout) !== entry.value) { continue; }
      await this.deps.git(folder, entry.previous === null
        ? ['config', '--local', '--unset-all', entry.key]
        : ['config', '--local', '--replace-all', entry.key, entry.previous]);
    }
    return true;
  }

  /** Undoes a folder's wiring and forgets it. `false` (record kept) only when git can't run, so it is retried. */
  private async release(folder: string, record: WiringRecord): Promise<boolean> {
    if (this.deps.exists(folder)) {
      const probe = await this.deps.git(folder, INSIDE_REPO);
      if (probe.code === GIT_UNAVAILABLE) { return false; }
      if (probe.code === 0 && !(await this.restore(folder, record))) { return false; }
      // Not a repo any more (or the folder is gone): there is no config left to clean.
    }
    await this.save(folder, undefined);
    return true;
  }

  private records(): Record<string, WiringRecord> {
    const raw = this.deps.meta.get<unknown>(WIRING_KEY);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { return {}; }
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, WiringRecord] => isRecord(e[1])));
  }

  private async save(folder: string, record: WiringRecord | undefined): Promise<void> {
    const { [folder]: _old, ...rest } = this.records();
    await this.deps.meta.update(WIRING_KEY, record ? { ...rest, [folder]: record } : rest);
  }
}

/** The warning worth showing for a skipped folder; `undefined` for the quiet reasons (a plain folder isn't an error). */
export function describeSkip(outcome: Extract<WireOutcome, { status: 'skipped' }>, folderName: string): string | undefined {
  switch (outcome.reason) {
    case 'git-missing': return `git was not found on your PATH, so the git identity for "${folderName}" was not set.`;
    case 'ssh-key-missing': return `The SSH key ${outcome.detail} was not found; the git settings for "${folderName}" were not changed.`;
    case 'config-failed': return `git refused a setting for "${folderName}": ${outcome.detail}`;
    case 'not-a-repo':
    case 'folder-missing': return undefined;
  }
}
