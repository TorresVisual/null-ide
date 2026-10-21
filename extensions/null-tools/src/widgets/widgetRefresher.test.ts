import assert from 'node:assert';
import test from 'node:test';
import { ApiError } from '../github/githubApi';
import { WidgetRefresher, RefresherDeps, REFRESH_MS, TICK_MS } from './widgetRefresher';
import { IssueRow, Snapshot, WidgetRepo } from './widgetTypes';
import { RepoResult } from './widgetFetch';

const row = (repo: string, n: number): IssueRow => ({ provider: 'github', repo, number: n, title: 't', url: '', state: 'open', labels: [], assignee: null, attention: 'assigned', localPath: null, updatedAt: '2026-10-21T10:00:00Z' });

function harness(over: { enabled?: boolean; repos?: WidgetRepo[]; owner?: boolean; fetch?: RefresherDeps['fetch'] } = {}) {
  let clock = Date.parse('2026-10-21T10:00:00Z');
  const writes: Snapshot[] = [];
  const state = { enabled: over.enabled ?? true, repos: over.repos ?? [{ repo: 'a/b', account: 'x' }], owner: over.owner ?? true, removed: 0, released: 0, claimed: 0, fetches: 0 };
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const deps: RefresherDeps = {
    now: () => clock,
    settings: () => ({ enabled: state.enabled, repos: state.repos }),
    ownership: { isOwner: () => state.owner, claim: () => { state.claimed++; }, release: () => { state.released++; } },
    fetch: over.fetch ?? (async (_a, repos) => { state.fetches++; return repos.map((repo): RepoResult => ({ repo, issues: [row(repo, 1)], prs: [] })); }),
    projects: async () => ({ status: 'ok', failed: [], items: [] }),
    store: { write: s => writes.push(s), remove: () => { state.removed++; } },
    setTimeout: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimeout: () => undefined, log: () => undefined,
  };
  return { r: new WidgetRefresher(deps), writes, state, timers, advance: (ms: number) => { clock += ms; } };
}

test('disabled: removes the snapshot, never fetches or writes', async () => {
  const h = harness({ enabled: false });
  await h.r.refresh();
  assert.strictEqual(h.state.removed, 1); assert.strictEqual(h.writes.length, 0); assert.strictEqual(h.state.fetches, 0);
});

test('a non-owner window does not fetch or write', async () => {
  const h = harness({ owner: false });
  await h.r.refresh();
  assert.strictEqual(h.state.fetches, 0); assert.strictEqual(h.writes.length, 0);
});

test('an owner cycle writes ok sections with the fetched rows and an ISO timestamp', async () => {
  const h = harness();
  await h.r.refresh();
  assert.strictEqual(h.writes.length, 1);
  const s = h.writes[0];
  assert.deepStrictEqual([s.schema, s.issues.status, s.issues.items.length, s.writtenAt], [1, 'ok', 1, '2026-10-21T10:00:00.000Z']);
});

test('partial failure keeps the failed repo\'s previous rows and lists it', async () => {
  const repos = [{ repo: 'a/b', account: 'x' }, { repo: 'c/d', account: 'x' }];
  let call = 0;
  const h = harness({ repos, fetch: async (_a, rs) => rs.map((repo): RepoResult =>
    (call++ >= 2 && repo === 'c/d') ? { repo, reason: 'error' } : { repo, issues: [row(repo, 1)], prs: [] }) });
  await h.r.refresh(); h.advance(REFRESH_MS); await h.r.refresh();
  const s = h.writes[1];
  assert.strictEqual(s.issues.status, 'ok');
  assert.deepStrictEqual(s.issues.failed, [{ repo: 'c/d', reason: 'error' }]);
  assert.strictEqual(s.issues.items.length, 2);                                   // c/d's old row survived
});

test('signed out: rows stay, status signed_out, nothing deleted', async () => {
  let ok = true;
  const h = harness({ fetch: async (_a, rs) => rs.map((repo): RepoResult => ok ? { repo, issues: [row(repo, 1)], prs: [] } : { repo, reason: 'signed_out' }) });
  await h.r.refresh(); ok = false; h.advance(REFRESH_MS); await h.r.refresh();
  assert.deepStrictEqual([h.writes[1].issues.status, h.writes[1].issues.items.length], ['signed_out', 1]);
  assert.strictEqual(h.state.removed, 0);
});

test('a rate limit suspends fetching until retryAt', async () => {
  let fetches = 0;
  const h = harness({ fetch: async (_a, rs) => { fetches++; return rs.map((repo): RepoResult => ({ repo, reason: 'error', retryAt: Date.parse('2026-10-21T10:30:00Z') })); } });
  await h.r.refresh();
  h.advance(REFRESH_MS); await h.r.refresh();                                      // 10:10, still suspended
  assert.strictEqual(fetches, 1);
  h.advance(25 * 60_000); await h.r.refresh();                                     // 10:35
  assert.strictEqual(fetches, 2);
});

test('removing a repo rewrites at once from remembered rows, without fetching', async () => {
  const h = harness({ repos: [{ repo: 'a/b', account: 'x' }, { repo: 'c/d', account: 'x' }] });
  await h.r.refresh();
  const fetched = h.state.fetches;
  h.state.repos = [{ repo: 'a/b', account: 'x' }];
  h.r.onConfigChanged();
  assert.strictEqual(h.writes.at(-1)!.issues.items.length, 1);
  assert.strictEqual(h.state.fetches, fetched);
});

test('turning widgets off through a settings change deletes the file', async () => {
  const h = harness();
  await h.r.refresh();
  h.state.enabled = false;
  h.r.onConfigChanged();
  assert.strictEqual(h.state.removed, 1);
});

test('focus claims ownership and refreshes, but not more than once a minute', async () => {
  const h = harness();
  h.r.setFocused(true); await Promise.resolve(); await new Promise(r => setImmediate(r));
  assert.strictEqual(h.state.claimed, 1); const first = h.state.fetches;
  h.r.setFocused(false); h.advance(10_000); h.r.setFocused(true); await new Promise(r => setImmediate(r));
  assert.strictEqual(h.state.fetches, first);
});

test('the tick refreshes a focused owner when due and a window that just became owner', async () => {
  const h = harness({ owner: false });
  h.r.start(); h.r.setFocused(true);
  h.state.owner = true;
  h.timers.at(-1)!.fn(); await new Promise(r => setImmediate(r));
  assert.ok(h.state.fetches >= 1);
  assert.strictEqual(h.timers.at(-1)!.ms, TICK_MS);
});

test('dispose writes once more as owner and releases ownership', async () => {
  const h = harness();
  await h.r.refresh();
  h.advance(5 * 60_000);
  h.r.dispose();
  assert.strictEqual(h.writes.length, 2);
  assert.strictEqual(h.writes[1].writtenAt, '2026-10-21T10:05:00.000Z');
  assert.strictEqual(h.state.released, 1);
});

test('a fetch that throws unexpectedly does not wipe rows or crash the cycle', async () => {
  let boom = false;
  const h = harness({ fetch: async (_a, rs) => { if (boom) { throw new ApiError('x', 500); } return rs.map((repo): RepoResult => ({ repo, issues: [row(repo, 1)], prs: [] })); } });
  await h.r.refresh(); boom = true; h.advance(REFRESH_MS);
  await assert.doesNotReject(h.r.refresh());
  assert.strictEqual(h.writes.at(-1)!.issues.items.length, 1);
});
