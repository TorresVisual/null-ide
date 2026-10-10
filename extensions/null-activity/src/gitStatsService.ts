/// <reference path="./protocol.ts" />
'use strict';

import { gitLogArgs, parseGitLog } from './gitLog';
import { DateRange } from './types';

export const GIT_TTL_MS = 60_000;

export type GitExec = (args: string[], cwd: string) => Promise<string>;

export interface GitStatsDeps {
  /** fsPaths of the open workspace folders. */
  folders(): string[];
  trusted(): boolean;
  /** `resolveProject(folder).key`, so results match `Share.key`. */
  resolveKey(folder: string): string;
  exec: GitExec;
  now(): number;
  log(message: string): void;
}

interface Entry {
  at: number;
  /** Undefined when the repo could not be read; kept so a broken repo is not retried every second. */
  totals?: GitTotals;
}

function assemble(found: Map<string, GitTotals | undefined>): DashboardGit | undefined {
  const byProject: Record<string, GitTotals> = {};
  const totals: GitTotals = { commits: 0, filesChanged: 0, linesAdded: 0, linesRemoved: 0 };
  for (const [key, t] of found) {
    if (!t) continue;
    byProject[key] = t;
    totals.commits += t.commits;
    totals.filesChanged += t.filesChanged;
    totals.linesAdded += t.linesAdded;
    totals.linesRemoved += t.linesRemoved;
  }
  return Object.keys(byProject).length > 0 ? { totals, byProject } : undefined;
}

/** Git statistics for the repos of the open workspace folders. No `vscode` import: everything arrives through `deps`. */
export class GitStatsService {
  // ponytail: one entry per (repo, range) ever asked for; the dashboard has five ranges, so this stays tiny.
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<Entry>>();
  private readonly warned = new Set<string>();

  constructor(private readonly deps: GitStatsDeps) {}

  /** Cached numbers for `range` (possibly stale, so the UI does not flicker) and whether a reload is due. */
  peek(range: DateRange): { fresh: boolean; git?: DashboardGit } {
    const now = this.deps.now();
    const found = new Map<string, GitTotals | undefined>();
    let fresh = true;
    for (const key of this.repos().keys()) {
      const entry = this.entries.get(entryKey(key, range));
      if (!entry || now - entry.at >= GIT_TTL_MS) fresh = false;
      found.set(key, entry?.totals);
    }
    return { fresh, git: assemble(found) };
  }

  /** Reads whatever is missing or stale. Never rejects: a repo that cannot be read is simply left out. */
  async load(range: DateRange): Promise<DashboardGit | undefined> {
    const found = new Map<string, GitTotals | undefined>();
    await Promise.all(
      [...this.repos()].map(async ([key, folder]) => {
        found.set(key, (await this.entry(key, folder, range)).totals);
      }),
    );
    return assemble(found);
  }

  /** key -> first folder, for the open folders. Empty in an untrusted workspace. */
  private repos(): Map<string, string> {
    const repos = new Map<string, string>();
    if (!this.deps.trusted()) return repos;
    for (const folder of this.deps.folders()) {
      const key = this.deps.resolveKey(folder);
      if (!repos.has(key)) repos.set(key, folder);
    }
    return repos;
  }

  private entry(key: string, folder: string, range: DateRange): Promise<Entry> {
    const id = entryKey(key, range);
    const hit = this.entries.get(id);
    if (hit && this.deps.now() - hit.at < GIT_TTL_MS) return Promise.resolve(hit);
    let pending = this.inflight.get(id);
    if (!pending) {
      pending = this.read(key, folder, range)
        .then((totals) => {
          const entry: Entry = { at: this.deps.now(), totals };
          this.entries.set(id, entry);
          return entry;
        })
        .finally(() => this.inflight.delete(id));
      this.inflight.set(id, pending);
    }
    return pending;
  }

  private async read(key: string, folder: string, range: DateRange): Promise<GitTotals | undefined> {
    try {
      const email = (await this.deps.exec(['config', '--get', 'user.email'], folder)).trim();
      if (!email) throw new Error('no user.email');
      return parseGitLog(await this.deps.exec(gitLogArgs(range, email), folder), email, range);
    } catch (err) {
      if (!this.warned.has(key)) {
        this.warned.add(key);
        this.deps.log(`git stats: skipped ${folder} (${err instanceof Error ? err.message : String(err)})`);
      }
      return undefined;
    }
  }
}

function entryKey(key: string, range: DateRange): string {
  return `${key}|${range.from}|${range.to}`;
}
