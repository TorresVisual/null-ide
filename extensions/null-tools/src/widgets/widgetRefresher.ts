'use strict';

import { classifyError, RepoResult } from './widgetFetch';
import { RepoOutcome, buildSection } from './widgetSections';
import { rankIssues, rankPrs } from './widgetQueries';
import { IssueRow, MAX_ISSUES, MAX_PRS, PrRow, ProjectRow, SCHEMA, Section, Snapshot, WidgetRepo } from './widgetTypes';

export const REFRESH_MS = 10 * 60_000;
export const TICK_MS = 60_000;
export const MAX_BACKOFF_MS = 60 * 60_000;
export const FOCUS_REFRESH_MIN_MS = 60_000;
const CONFIG_REFRESH_DELAY_MS = 1_000;

export interface RefresherDeps { /* exactly as listed under Interfaces */
  now(): number;
  settings(): { enabled: boolean; repos: WidgetRepo[] };
  ownership: { isOwner(): boolean; claim(): void; release(): void };
  fetch(accountId: string, repos: string[]): Promise<RepoResult[]>;
  projects(): Promise<Section<ProjectRow>>;
  store: { write(s: Snapshot): void; remove(): void };
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  log(message: string): void;
}

const empty = <T>(): Section<T> => ({ status: 'ok', failed: [], items: [] });

export class WidgetRefresher {
  private issueRows = new Map<string, IssueRow[]>();
  private prRows = new Map<string, PrRow[]>();
  private sections = { projects: empty<ProjectRow>(), issues: empty<IssueRow>(), prs: empty<PrRow>() };
  private wrote = false;
  private owner = false;
  private focused = false;
  private running = false;
  private failures = 0;
  private lastFetch = 0;
  private suspendedUntil = 0;
  private timer: unknown;

  constructor(private readonly d: RefresherDeps) {}

  start(): void { this.schedule(); }

  setFocused(focused: boolean): void {
    this.focused = focused;
    if (!focused || !this.d.settings().enabled) { return; }
    this.d.ownership.claim();
    this.owner = true;
    if (this.d.now() - this.lastFetch >= FOCUS_REFRESH_MIN_MS) { void this.refresh(); }
  }

  async refresh(): Promise<void> {
    const cfg = this.d.settings();
    if (!cfg.enabled) { this.disable(); return; }
    if (!this.d.ownership.isOwner()) { this.owner = false; return; }
    this.owner = true;
    if (this.running || this.d.now() < this.suspendedUntil) { return; }
    this.running = true;
    try {
      this.lastFetch = this.d.now();
      const byAccount = new Map<string, string[]>();
      for (const { repo, account } of cfg.repos) { byAccount.set(account, [...(byAccount.get(account) ?? []), repo]); }
      const results: RepoResult[] = [];
      for (const [account, repos] of byAccount) {
        try { results.push(...await this.d.fetch(account, repos)); }
        catch (err) { const c = classifyError(err); results.push(...repos.map(repo => ({ repo, reason: c.reason, retryAt: c.retryAt }))); }
      }
      const issues: RepoOutcome<IssueRow>[] = [], prs: RepoOutcome<PrRow>[] = [];
      let retryAt = 0;
      for (const r of results) {
        if ('reason' in r) {
          issues.push({ repo: r.repo, rows: null, reason: r.reason }); prs.push({ repo: r.repo, rows: null, reason: r.reason });
          retryAt = Math.max(retryAt, r.retryAt ?? 0);
        } else {
          issues.push({ repo: r.repo, rows: r.issues }); prs.push({ repo: r.repo, rows: r.prs });
        }
      }
      const i = buildSection(issues, this.issueRows, rankIssues, MAX_ISSUES), p = buildSection(prs, this.prRows, rankPrs, MAX_PRS);
      this.issueRows = i.kept; this.prRows = p.kept;
      this.sections.issues = i.section; this.sections.prs = p.section;
      const allFailed = results.length > 0 && results.every(r => 'reason' in r);
      this.failures = allFailed ? this.failures + 1 : 0;
      if (retryAt > 0) { this.suspendedUntil = retryAt; }
      try { this.sections.projects = await this.d.projects(); } catch (err) { this.d.log(`projects: ${(err as Error).message}`); }
      this.write();
    } finally { this.running = false; }
  }

  onConfigChanged(): void {
    const cfg = this.d.settings();
    if (!cfg.enabled) { this.disable(); return; }
    const keep = new Set(cfg.repos.map(r => r.repo.toLowerCase()));
    for (const k of [...this.issueRows.keys()]) { if (!keep.has(k)) { this.issueRows.delete(k); } }
    for (const k of [...this.prRows.keys()]) { if (!keep.has(k)) { this.prRows.delete(k); } }
    this.sections.issues = { ...this.sections.issues, items: rankIssues([...this.issueRows.values()].flat()).slice(0, MAX_ISSUES), failed: this.sections.issues.failed.filter(f => keep.has(f.repo.toLowerCase())) };
    this.sections.prs = { ...this.sections.prs, items: rankPrs([...this.prRows.values()].flat()).slice(0, MAX_PRS), failed: this.sections.prs.failed.filter(f => keep.has(f.repo.toLowerCase())) };
    if (this.wrote && this.d.ownership.isOwner()) { this.write(); }
    this.d.setTimeout(() => void this.refresh(), CONFIG_REFRESH_DELAY_MS);  // debounced, and never inside the call that changed the config
  }

  dispose(): void {
    if (this.timer) { this.d.clearTimeout(this.timer); this.timer = undefined; }
    if (this.owner && this.wrote && this.d.settings().enabled) { try { this.write(); } catch (err) { this.d.log(`final write: ${(err as Error).message}`); } }
    this.d.ownership.release();
  }

  private disable(): void {
    this.d.store.remove();
    this.wrote = false;
    this.d.ownership.release();
    this.owner = false;
  }

  private write(): void {
    this.d.store.write({ schema: SCHEMA, writtenAt: new Date(this.d.now()).toISOString(), ...this.sections });
    this.wrote = true;
  }

  private nextDelay(): number {
    const base = this.failures > 0 ? Math.min(REFRESH_MS * 2 ** this.failures, MAX_BACKOFF_MS) : REFRESH_MS;
    return Math.max(base, this.suspendedUntil - this.d.now());
  }

  private schedule(): void {
    this.timer = this.d.setTimeout(() => void this.tick(), TICK_MS);
  }

  private async tick(): Promise<void> {
    try {
      if (this.d.settings().enabled) {
        const was = this.owner;
        this.owner = this.d.ownership.isOwner();
        const due = this.d.now() - this.lastFetch >= this.nextDelay();
        if (this.owner && (!was || (this.focused && due))) { await this.refresh(); }
      }
    } catch (err) { this.d.log(`tick: ${(err as Error).message}`); }
    this.schedule();
  }
}
