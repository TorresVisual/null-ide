'use strict';

import { ApiError } from '../github/githubApi';

type Raw = Record<string, any>;

export interface WorkflowRun {
  id: number; workflowId: number; title: string; status: string; conclusion: string | null;
  branch: string; sha: string; event: string; number: number; attempt: number;
  startedAt: string | null; updatedAt: string; url: string; actor: string;
}
export interface WorkflowStep { number: number; name: string; status: string; conclusion: string | null; startedAt: string | null; completedAt: string | null }
export interface WorkflowJob {
  id: number; name: string; status: string; conclusion: string | null;
  startedAt: string | null; completedAt: string | null; url: string; steps: WorkflowStep[];
}
export interface Workflow { id: number; name: string; path: string; state: string }
export interface RepoRef { key: string; owner: string; repo: string }
export interface Glyph { icon: string; color?: string }

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Only github.com pages are ever opened from a payload; anything else becomes ''. */
export const githubUrl = (v: unknown): string => (typeof v === 'string' && v.startsWith('https://github.com/') ? v : '');

export function mapRun(r: Raw): WorkflowRun {
  return {
    id: r.id, workflowId: r.workflow_id, title: str(r.display_title) || str(r.name), status: str(r.status),
    conclusion: strOrNull(r.conclusion), branch: str(r.head_branch), sha: str(r.head_sha), event: str(r.event),
    number: r.run_number, attempt: typeof r.run_attempt === 'number' ? r.run_attempt : 1,
    startedAt: strOrNull(r.run_started_at) ?? strOrNull(r.created_at), updatedAt: str(r.updated_at),
    url: githubUrl(r.html_url), actor: str(r.actor?.login),
  };
}

export function mapJob(j: Raw): WorkflowJob {
  const steps = (Array.isArray(j.steps) ? j.steps : []).filter((s: unknown) => typeof s === 'object' && s !== null).map((s: Raw): WorkflowStep => ({
    number: s.number, name: str(s.name), status: str(s.status), conclusion: strOrNull(s.conclusion),
    startedAt: strOrNull(s.started_at), completedAt: strOrNull(s.completed_at),
  }));
  return {
    id: j.id, name: str(j.name), status: str(j.status), conclusion: strOrNull(j.conclusion),
    startedAt: strOrNull(j.started_at), completedAt: strOrNull(j.completed_at), url: githubUrl(j.html_url), steps,
  };
}

export const mapWorkflow = (w: Raw): Workflow => ({ id: w.id, name: str(w.name), path: str(w.path), state: str(w.state) });

// ── status ──────────────────────────────────────────────────────────────────

const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);

export const isActive = (s: { status: string }): boolean => ACTIVE.has(s.status);
export const isFailed = (s: { status: string; conclusion: string | null }): boolean =>
  s.status === 'completed' && s.conclusion !== null && FAILED.has(s.conclusion);

/** The one icon function for run, job and step rows, so they always agree. */
export function statusIcon(status: string, conclusion: string | null): Glyph {
  if (status === 'completed') {
    if (conclusion === 'success') return { icon: 'pass', color: 'charts.green' };
    if (conclusion !== null && FAILED.has(conclusion)) return { icon: 'error', color: 'charts.red' };
    if (conclusion === 'cancelled') return { icon: 'circle-slash' };
    if (conclusion === 'action_required') return { icon: 'warning', color: 'charts.yellow' };
    return { icon: 'debug-step-over' }; // skipped, neutral, stale
  }
  if (status === 'in_progress') return { icon: 'sync~spin', color: 'charts.yellow' };
  if (ACTIVE.has(status)) return { icon: 'clock' };
  return { icon: 'circle-outline' };
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Time between two ISO timestamps (`end` null = still running, measured to `now`); '' when it cannot be told. */
export function elapsed(start: string | null, end: string | null, now: number): string {
  if (!start) return '';
  const from = Date.parse(start);
  const to = end ? Date.parse(end) : now;
  return Number.isNaN(from) || Number.isNaN(to) ? '' : formatDuration(to - from);
}

export function runDescription(run: WorkflowRun, now: number): string {
  const duration = elapsed(run.startedAt, isActive(run) ? null : run.updatedAt, now);
  const parts = [run.branch, run.sha.slice(0, 7), run.event, duration, `#${run.number}`].filter(Boolean);
  if (run.attempt > 1) parts.push(`attempt ${run.attempt}`);
  return parts.join(' · ');
}

// ── actions ─────────────────────────────────────────────────────────────────

export type RunAction = 'rerunAll' | 'rerunFailed' | 'cancel' | 'rerunJob';

export function runActions(run: { status: string; conclusion: string | null }): RunAction[] {
  if (isActive(run)) return ['cancel'];
  if (run.status !== 'completed') return [];
  return isFailed(run) ? ['rerunAll', 'rerunFailed'] : ['rerunAll'];
}

/** Why `action` cannot be done to `target` as it is *now* (the host re-reads it first), or null when it can. */
export function refusal(action: RunAction, target: { status: string; conclusion: string | null }): string | null {
  switch (action) {
    case 'cancel': return isActive(target) ? null : 'It already finished.';
    case 'rerunAll': case 'rerunJob': return target.status === 'completed' ? null : 'It is still running.';
    case 'rerunFailed':
      if (target.status !== 'completed') return 'It is still running.';
      return isFailed(target) ? null : 'It has no failed jobs.';
  }
}

export const runContext = (run: WorkflowRun): string =>
  ['run', ...(isFailed(run) ? ['failed'] : []), ...runActions(run)].join(' ');
export const jobContext = (job: WorkflowJob): string =>
  ['job', ...(isFailed(job) ? ['failed'] : []), ...(job.status === 'completed' ? ['rerunJob'] : [])].join(' ');
export const stepContext = (step: WorkflowStep): string => (isFailed(step) ? 'step failed' : 'step');
export const workflowContext = (w: Workflow, dispatchable: boolean): string =>
  ['workflow', ...(w.state !== 'active' ? ['enable'] : dispatchable ? ['dispatch'] : [])].join(' ');

/** GitHub's own words, plus a hint for a plain 403 (rate limits carry `retryAt` and are not a permission problem). */
export function actionFailureText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403 && err.retryAt === null) return `${err.message} — this needs write access to the repository and Actions enabled.`;
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

// ── filter ──────────────────────────────────────────────────────────────────

/** Stored per workspace and applied to every repo. `workflow` is a file name (`ci.yml`), which the API accepts as a workflow id. */
export interface RunFilter { branch: boolean; mine: boolean; failed: boolean; workflow: string | null }
export const DEFAULT_FILTER: RunFilter = { branch: false, mine: false, failed: false, workflow: null };
export const PAGE_SIZE = 30;

export const isWorkflowFile = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._-]{1,100}\.ya?ml$/.test(v);

export function parseFilter(raw: unknown): RunFilter {
  const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    branch: o.branch === true, mine: o.mine === true, failed: o.failed === true,
    workflow: isWorkflowFile(o.workflow) ? o.workflow : null,
  };
}

export const isDefaultFilter = (f: RunFilter): boolean => !f.branch && !f.mine && !f.failed && f.workflow === null;

export function describeFilter(f: RunFilter): string {
  return [f.branch && 'Current branch', f.mine && 'My runs', f.failed && 'Failed only', f.workflow].filter(Boolean).join(' · ');
}

export type FilterRowId = 'branch' | 'mine' | 'failed' | 'workflow';
export function filterRows(f: RunFilter): Array<{ id: FilterRowId; label: string; description: string }> {
  const on = (v: boolean): string => (v ? 'on' : 'off');
  return [
    { id: 'branch', label: 'Current branch', description: on(f.branch) },
    { id: 'mine', label: 'My runs', description: on(f.mine) },
    { id: 'failed', label: 'Failed only', description: on(f.failed) },
    { id: 'workflow', label: 'Workflow', description: f.workflow ?? 'any' },
  ];
}

/** REST path of one page of runs. A qualifier whose value is unknown (detached HEAD, no login) is dropped. */
export function runsPath(owner: string, repo: string, f: RunFilter, ctx: { branch: string | null; login: string | null }, page: number): string {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions`;
  const head = f.workflow ? `${base}/workflows/${encodeURIComponent(f.workflow)}/runs` : `${base}/runs`;
  const q = [`per_page=${PAGE_SIZE}`, `page=${page}`];
  if (f.branch && ctx.branch) q.push(`branch=${encodeURIComponent(ctx.branch)}`);
  if (f.mine && ctx.login) q.push(`actor=${encodeURIComponent(ctx.login)}`);
  if (f.failed) q.push('status=failure');
  return `${head}?${q.join('&')}`;
}

// ── tree rows ───────────────────────────────────────────────────────────────

export type WfNode =
  | { kind: 'repo'; repo: RepoRef }
  | { kind: 'signin'; repo: RepoRef }
  | { kind: 'error'; repo: RepoRef; text: string }
  | { kind: 'note'; repo: RepoRef; text: string; id: string; command?: string }
  | { kind: 'group'; repo: RepoRef; group: 'runs' | 'workflows' }
  | { kind: 'run'; repo: RepoRef; run: WorkflowRun }
  | { kind: 'job'; repo: RepoRef; run: WorkflowRun; job: WorkflowJob }
  | { kind: 'step'; repo: RepoRef; run: WorkflowRun; job: WorkflowJob; step: WorkflowStep }
  | { kind: 'workflow'; repo: RepoRef; workflow: Workflow; dispatchable: boolean }
  | { kind: 'more'; repo: RepoRef };

export function nodeId(n: WfNode): string {
  const k = n.repo.key;
  switch (n.kind) {
    case 'repo': return `wf:${k}`;
    case 'signin': return `wf:${k}/signin`;
    case 'error': return `wf:${k}/error`;
    case 'note': return `wf:${k}/note/${n.id}`;
    case 'group': return `wf:${k}/${n.group}`;
    case 'run': return `wf:${k}/run/${n.run.id}`;
    case 'job': return `wf:${k}/run/${n.run.id}/job/${n.job.id}`;
    case 'step': return `wf:${k}/run/${n.run.id}/job/${n.job.id}/step/${n.step.number}`;
    case 'workflow': return `wf:${k}/workflow/${n.workflow.id}`;
    case 'more': return `wf:${k}/more`;
  }
}

export interface NodeView {
  id: string; label: string; description?: string; tooltip?: string; icon: Glyph;
  collapsible: 'none' | 'collapsed' | 'expanded'; context: string;
}

/** View data for the rows that come straight from API payloads; the glue turns it into a TreeItem. */
export function describeNode(n: WfNode, ctx: { now: number; branch: string | null }): NodeView {
  const id = nodeId(n);
  switch (n.kind) {
    case 'run': {
      const current = ctx.branch !== null && n.run.branch === ctx.branch;
      return {
        id, label: n.run.title, description: `${current ? '● ' : ''}${runDescription(n.run, ctx.now)}`,
        tooltip: `${n.run.title}\n#${n.run.number} by ${n.run.actor || 'unknown'}\n${n.run.conclusion ?? n.run.status}`,
        icon: statusIcon(n.run.status, n.run.conclusion), collapsible: 'collapsed', context: runContext(n.run),
      };
    }
    case 'job':
      return {
        id, label: n.job.name, description: elapsed(n.job.startedAt, n.job.completedAt, ctx.now),
        icon: statusIcon(n.job.status, n.job.conclusion),
        collapsible: isFailed(n.job) ? 'expanded' : 'collapsed', context: jobContext(n.job),
      };
    case 'step':
      return {
        id, label: n.step.name, description: elapsed(n.step.startedAt, n.step.completedAt, ctx.now),
        icon: statusIcon(n.step.status, n.step.conclusion), collapsible: 'none', context: stepContext(n.step),
      };
    case 'workflow': {
      const disabled = n.workflow.state !== 'active';
      return {
        id, label: n.workflow.name, description: disabled ? 'disabled' : n.workflow.path,
        tooltip: `${n.workflow.name}\n${n.workflow.path}${disabled ? `\n${n.workflow.state}` : ''}`,
        icon: { icon: 'file-code', color: disabled ? 'disabledForeground' : undefined }, collapsible: 'none',
        context: workflowContext(n.workflow, n.dispatchable),
      };
    }
    default:
      throw new Error(`describeNode does not describe "${n.kind}" rows`);
  }
}

/** One repo per `owner/repo`, case-insensitively; the first folder wins. */
export function dedupeRepos<T extends { repo: RepoRef }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(i => {
    const key = i.repo.key.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A fresh first page over the runs already loaded: the page replaces its own rows, older pages stay. */
export function mergeRuns(fresh: WorkflowRun[], old: WorkflowRun[]): WorkflowRun[] {
  const ids = new Set(fresh.map(r => r.id));
  return [...fresh, ...old.filter(r => !ids.has(r.id))];
}

// ── polling and small helpers ───────────────────────────────────────────────

export const POLL_FAST_MS = 10_000;
export const POLL_SLOW_MS = 30_000;
const SLOW_AFTER_MS = 10 * 60_000;
const BACKOFF = [10_000, 30_000, 60_000];

/** Delay until the next poll. `retryAt` (a rate limit) wins when it is later than the normal delay. */
export function pollDelay(i: { oldestActiveSince: number | null; now: number; failures: number; retryAt: number | null }): number {
  const base = i.failures > 0
    ? BACKOFF[Math.min(i.failures, BACKOFF.length) - 1]
    : i.oldestActiveSince !== null && i.now - i.oldestActiveSince > SLOW_AFTER_MS ? POLL_SLOW_MS : POLL_FAST_MS;
  return i.retryAt !== null && i.retryAt - i.now > base ? i.retryAt - i.now : base;
}

export function branchChoices(branches: string[], current: string | null): string[] {
  return current !== null && branches.includes(current) ? [current, ...branches.filter(b => b !== current)] : [...branches];
}

/** Loose check for a ref the user typed; GitHub gives the final verdict (422). */
export function isPlausibleRef(ref: string): boolean {
  return ref.length > 0 && ref.length <= 250 && !/[\s~^:?*[\\\u0000-\u001f\u007f]/.test(ref) && !ref.includes('..') && !ref.startsWith('-');
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
