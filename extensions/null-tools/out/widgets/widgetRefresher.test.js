"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const githubApi_1 = require("../github/githubApi");
const widgetRefresher_1 = require("./widgetRefresher");
const row = (repo, n) => ({ provider: 'github', repo, number: n, title: 't', url: '', state: 'open', labels: [], assignee: null, attention: 'assigned', localPath: null, updatedAt: '2026-10-21T10:00:00Z' });
function harness(over = {}) {
    let clock = Date.parse('2026-10-21T10:00:00Z');
    const writes = [];
    const state = { enabled: over.enabled ?? true, repos: over.repos ?? [{ repo: 'a/b', account: 'x' }], owner: over.owner ?? true, removed: 0, released: 0, claimed: 0, fetches: 0 };
    const timers = [];
    const deps = {
        now: () => clock,
        settings: () => ({ enabled: state.enabled, repos: state.repos }),
        ownership: { isOwner: () => state.owner, claim: () => { state.claimed++; }, release: () => { state.released++; } },
        fetch: over.fetch ?? (async (_a, repos) => { state.fetches++; return repos.map((repo) => ({ repo, issues: [row(repo, 1)], prs: [] })); }),
        projects: over.projects ?? (async () => ({ status: 'ok', failed: [], items: [] })),
        store: { write: s => writes.push(s), remove: () => { state.removed++; } },
        setTimeout: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
        clearTimeout: () => undefined, log: () => undefined,
    };
    return { r: new widgetRefresher_1.WidgetRefresher(deps), writes, state, timers, advance: (ms) => { clock += ms; } };
}
(0, node_test_1.default)('disabled: removes the snapshot, never fetches or writes', async () => {
    const h = harness({ enabled: false });
    await h.r.refresh();
    node_assert_1.default.strictEqual(h.state.removed, 1);
    node_assert_1.default.strictEqual(h.writes.length, 0);
    node_assert_1.default.strictEqual(h.state.fetches, 0);
});
(0, node_test_1.default)('a non-owner window does not fetch or write', async () => {
    const h = harness({ owner: false });
    await h.r.refresh();
    node_assert_1.default.strictEqual(h.state.fetches, 0);
    node_assert_1.default.strictEqual(h.writes.length, 0);
});
(0, node_test_1.default)('an owner cycle writes ok sections with the fetched rows and an ISO timestamp', async () => {
    const h = harness();
    await h.r.refresh();
    node_assert_1.default.strictEqual(h.writes.length, 1);
    const s = h.writes[0];
    node_assert_1.default.deepStrictEqual([s.schema, s.issues.status, s.issues.items.length, s.writtenAt], [1, 'ok', 1, '2026-10-21T10:00:00.000Z']);
});
(0, node_test_1.default)('partial failure keeps the failed repo\'s previous rows and lists it', async () => {
    const repos = [{ repo: 'a/b', account: 'x' }, { repo: 'c/d', account: 'x' }];
    let call = 0;
    const h = harness({ repos, fetch: async (_a, rs) => rs.map((repo) => (call++ >= 2 && repo === 'c/d') ? { repo, reason: 'error' } : { repo, issues: [row(repo, 1)], prs: [] }) });
    await h.r.refresh();
    h.advance(widgetRefresher_1.REFRESH_MS);
    await h.r.refresh();
    const s = h.writes[1];
    node_assert_1.default.strictEqual(s.issues.status, 'ok');
    node_assert_1.default.deepStrictEqual(s.issues.failed, [{ repo: 'c/d', reason: 'error' }]);
    node_assert_1.default.strictEqual(s.issues.items.length, 2); // c/d's old row survived
});
(0, node_test_1.default)('signed out: rows stay, status signed_out, nothing deleted', async () => {
    let ok = true;
    const h = harness({ fetch: async (_a, rs) => rs.map((repo) => ok ? { repo, issues: [row(repo, 1)], prs: [] } : { repo, reason: 'signed_out' }) });
    await h.r.refresh();
    ok = false;
    h.advance(widgetRefresher_1.REFRESH_MS);
    await h.r.refresh();
    node_assert_1.default.deepStrictEqual([h.writes[1].issues.status, h.writes[1].issues.items.length], ['signed_out', 1]);
    node_assert_1.default.strictEqual(h.state.removed, 0);
});
(0, node_test_1.default)('a rate limit suspends fetching until retryAt', async () => {
    let fetches = 0;
    const h = harness({ fetch: async (_a, rs) => { fetches++; return rs.map((repo) => ({ repo, reason: 'error', retryAt: Date.parse('2026-10-21T10:30:00Z') })); } });
    await h.r.refresh();
    h.advance(widgetRefresher_1.REFRESH_MS);
    await h.r.refresh(); // 10:10, still suspended
    node_assert_1.default.strictEqual(fetches, 1);
    h.advance(25 * 60_000);
    await h.r.refresh(); // 10:35
    node_assert_1.default.strictEqual(fetches, 2);
});
(0, node_test_1.default)('removing a repo rewrites at once from remembered rows, without fetching', async () => {
    const h = harness({ repos: [{ repo: 'a/b', account: 'x' }, { repo: 'c/d', account: 'x' }] });
    await h.r.refresh();
    const fetched = h.state.fetches;
    h.state.repos = [{ repo: 'a/b', account: 'x' }];
    h.r.onConfigChanged();
    node_assert_1.default.strictEqual(h.writes.at(-1).issues.items.length, 1);
    node_assert_1.default.strictEqual(h.state.fetches, fetched);
});
(0, node_test_1.default)('turning widgets off through a settings change deletes the file', async () => {
    const h = harness();
    await h.r.refresh();
    h.state.enabled = false;
    h.r.onConfigChanged();
    node_assert_1.default.strictEqual(h.state.removed, 1);
});
(0, node_test_1.default)('focus claims ownership and refreshes, but not more than once a minute', async () => {
    const h = harness();
    h.r.setFocused(true);
    await Promise.resolve();
    await new Promise(r => setImmediate(r));
    node_assert_1.default.strictEqual(h.state.claimed, 1);
    const first = h.state.fetches;
    h.r.setFocused(false);
    h.advance(10_000);
    h.r.setFocused(true);
    await new Promise(r => setImmediate(r));
    node_assert_1.default.strictEqual(h.state.fetches, first);
});
(0, node_test_1.default)('the tick refreshes a focused owner when due and a window that just became owner', async () => {
    const h = harness({ owner: false });
    h.r.start();
    h.r.setFocused(true);
    h.state.owner = true;
    h.timers.at(-1).fn();
    await new Promise(r => setImmediate(r));
    node_assert_1.default.ok(h.state.fetches >= 1);
    node_assert_1.default.strictEqual(h.timers.at(-1).ms, widgetRefresher_1.TICK_MS);
});
(0, node_test_1.default)('dispose writes once more as owner, keeps the time of the last fetch, and releases ownership', async () => {
    const h = harness();
    await h.r.refresh();
    h.advance(5 * 60_000);
    h.r.dispose();
    node_assert_1.default.strictEqual(h.writes.length, 2);
    node_assert_1.default.strictEqual(h.writes[1].writtenAt, '2026-10-21T10:00:00.000Z'); // the rows are still the 10:00 rows; the footer must keep ageing
    node_assert_1.default.strictEqual(h.state.released, 1);
});
(0, node_test_1.default)('a fetch that throws unexpectedly does not wipe rows or crash the cycle', async () => {
    let boom = false;
    const h = harness({ fetch: async (_a, rs) => { if (boom) {
            throw new githubApi_1.ApiError('x', 500);
        } return rs.map((repo) => ({ repo, issues: [row(repo, 1)], prs: [] })); } });
    await h.r.refresh();
    boom = true;
    h.advance(widgetRefresher_1.REFRESH_MS);
    await node_assert_1.default.doesNotReject(h.r.refresh());
    node_assert_1.default.strictEqual(h.writes.at(-1).issues.items.length, 1);
});
(0, node_test_1.default)('a settings change rewrites without making the old rows look fresh', async () => {
    const h = harness({ repos: [{ repo: 'a/b', account: 'x' }, { repo: 'c/d', account: 'x' }] });
    await h.r.refresh();
    h.advance(3 * 60 * 60_000);
    h.state.repos = [{ repo: 'a/b', account: 'x' }];
    h.r.onConfigChanged();
    node_assert_1.default.strictEqual(h.writes.at(-1).writtenAt, '2026-10-21T10:00:00.000Z');
});
(0, node_test_1.default)('projects are read before the fetch, so issue and PR rows get the local checkouts of this cycle', async () => {
    const order = [];
    const h = harness({
        projects: async () => { order.push('projects'); return { status: 'ok', failed: [], items: [] }; },
        fetch: async (_a, rs) => { order.push('fetch'); return rs.map((repo) => ({ repo, issues: [], prs: [] })); },
    });
    await h.r.refresh();
    node_assert_1.default.deepStrictEqual(order, ['projects', 'fetch']);
});
//# sourceMappingURL=widgetRefresher.test.js.map