'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_vm_1 = __importDefault(require("node:vm"));
// The pull request tab's HTML builders are plain top-level functions in a `module: none` bundle: load the compiled
// shared bundle (built by `tsc -p tsconfig.webview-shared.json`) into a sandbox, like webviewDetail.test.ts does.
const sandbox = node_vm_1.default.createContext({});
node_vm_1.default.runInContext((0, node_fs_1.readFileSync)(node_path_1.default.join(__dirname, 'webview-shared.js'), 'utf8'), sandbox);
const html = sandbox;
const user = { login: 'octocat', avatar: 'https://avatars.githubusercontent.com/u/1?v=4' };
const page = (over = {}) => ({
    number: 12, title: 'Add x', url: 'https://github.com/o/r/pull/12', state: 'open', draft: false, author: user,
    createdAt: '2026-10-01T10:00:00Z', bodyHTML: '<p>Hello</p>', headRef: 'feat/x', baseRef: 'main', fork: false,
    additions: 10, deletions: 2, changedFiles: 3, labels: [{ name: 'bug', color: 'd73a4a' }], milestone: 'v1',
    assignees: [user], reviewers: [], commits: [], commitTotal: 0, timeline: [], timelineTotal: 0,
    checkState: 'none', checks: [], checksTotal: 0,
    id: 'PR_1', headSha: 'c'.repeat(40),
    actions: {
        review: { available: true, canApprove: true, pending: null },
        merge: { enabled: true, hint: 'Ready to merge.', methods: ['MERGE', 'SQUASH'] },
        state: 'close', draft: 'draft',
    },
    ...over,
});
const check = (over = {}) => ({ name: 'test', state: 'success', url: 'https://github.com/o/r/actions/runs/1', runId: 1, description: '', ...over });
(0, node_test_1.default)('title, branches and author are escaped', () => {
    const out = html.pullPageHtml(page({
        title: '<img src=x onerror=alert(1)>', headRef: '<b>h</b>', baseRef: 'a"b', author: { login: '<i>me</i>', avatar: '' },
    }));
    node_assert_1.default.ok(!out.includes('<img src=x'), 'title');
    node_assert_1.default.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'));
    node_assert_1.default.ok(!out.includes('<b>h</b>') && out.includes('&lt;b&gt;h&lt;/b&gt;'), 'branch');
    node_assert_1.default.ok(!out.includes('<i>me</i>'), 'author');
});
(0, node_test_1.default)('state badge: open, draft, merged, closed', () => {
    const badge = (tone, text) => new RegExp(`class="state-badge ${tone}">.*?</svg> ${text}</span>`, 's');
    node_assert_1.default.match(html.pullPageHtml(page()), badge('state-open', 'Open'));
    node_assert_1.default.match(html.pullPageHtml(page({ draft: true })), badge('state-not-planned', 'Draft'));
    const merged = html.pullPageHtml(page({ state: 'merged' }));
    node_assert_1.default.match(merged, badge('state-completed', 'Merged'));
    node_assert_1.default.ok(merged.includes(' merged <code>'));
    node_assert_1.default.match(html.pullPageHtml(page({ state: 'closed' })), badge('state-closed', 'Closed'));
});
(0, node_test_1.default)('a draft that is already merged shows its real state', () => {
    node_assert_1.default.match(html.pullPageHtml(page({ state: 'merged', draft: true })), /class="state-badge state-completed">/);
});
(0, node_test_1.default)('the description is shown, or a hint when empty', () => {
    node_assert_1.default.ok(html.pullPageHtml(page()).includes('<p>Hello</p>'));
    node_assert_1.default.ok(html.pullPageHtml(page({ bodyHTML: '' })).includes('No description provided.'));
});
(0, node_test_1.default)('checks section: absent without checks; failing first; summary; re-run only for a failed row that has a run', () => {
    node_assert_1.default.ok(!html.pullPageHtml(page()).includes('class="checks"'));
    // The host model sorts failures first; the page renders the rows in the order it is given.
    const rows = [check({ name: 'unit', state: 'failure', runId: 7 }), check({ name: 'build', state: 'pending', runId: null }), check({ name: 'lint', state: 'success' })];
    const out = html.pullPageHtml(page({ checks: rows, checksTotal: 3 }));
    node_assert_1.default.ok(out.includes('class="checks"'));
    node_assert_1.default.ok(out.indexOf('unit') < out.indexOf('build') && out.indexOf('build') < out.indexOf('lint'));
    node_assert_1.default.ok(out.includes('1 failing, 1 in progress, 1 successful'));
    node_assert_1.default.ok(out.includes('data-act="rerun"'));
    const noRun = html.pullPageHtml(page({ checks: [check({ state: 'failure', runId: null })], checksTotal: 1 }));
    node_assert_1.default.ok(!noRun.includes('data-act="rerun"'), 'a failed legacy status has no run to re-run');
    const allGood = html.pullPageHtml(page({ checks: [check()], checksTotal: 1 }));
    node_assert_1.default.ok(!allGood.includes('data-act="rerun"'), 'nothing failed');
});
(0, node_test_1.default)('checks: names and links are escaped, and more checks than shown are admitted', () => {
    const out = html.pullPageHtml(page({
        checks: [check({ name: '<script>x</script>', url: 'https://x/?a="b"', description: '<i>d</i>' })], checksTotal: 150,
    }));
    node_assert_1.default.ok(!out.includes('<script>x') && !out.includes('<i>d</i>'));
    node_assert_1.default.ok(out.includes('href="https://x/?a=&quot;b&quot;"'));
    node_assert_1.default.ok(out.includes('Showing 1 of 150 checks.'));
});
(0, node_test_1.default)('checkSummary names only non-empty groups', () => {
    node_assert_1.default.strictEqual(html.checkSummary([check(), check({ state: 'neutral' }), check({ state: 'neutral' })]), '1 successful, 2 skipped');
    node_assert_1.default.strictEqual(html.checkSummary([]), '');
});
(0, node_test_1.default)('timeline: a bodiless review is one compact row; a review with a body is a card; comments and events', () => {
    const out = html.pullPageHtml(page({ timelineTotal: 4, timeline: [
            { kind: 'review', author: { login: 'rev', avatar: '' }, at: '2026-10-02T10:00:00Z', verdict: 'approved', bodyHTML: '', url: 'https://github.com/o/r/pull/12#r1', comments: 2 },
            { kind: 'review', author: { login: 'pick', avatar: '' }, at: '2026-10-02T11:00:00Z', verdict: 'changes', bodyHTML: '<p>please fix</p>', url: 'https://github.com/o/r/pull/12#r2', comments: 0 },
            { kind: 'comment', author: { login: 'talker', avatar: '' }, at: '2026-10-02T12:00:00Z', bodyHTML: '<p>nice</p>', url: 'u' },
            { kind: 'event', at: '2026-10-03T10:00:00Z', actor: 'maint', event: 'merged' },
        ] }));
    node_assert_1.default.match(out, /tl-event[^]*rev<\/b> approved these changes with 2 inline comments/);
    node_assert_1.default.ok(out.includes('<p>please fix</p>'), 'review body shown');
    node_assert_1.default.match(out, /pick<\/b><span class="post-when">requested changes/);
    node_assert_1.default.ok(out.includes('<p>nice</p>'));
    node_assert_1.default.match(out, /maint<\/b> merged this/);
    node_assert_1.default.ok(!out.includes('Showing the first'), 'nothing is cut off');
});
(0, node_test_1.default)('truncation: more events than shown, and more commits than shown, are admitted', () => {
    const out = html.pullPageHtml(page({
        timelineTotal: 230,
        commitTotal: 130,
        commits: [{ sha: 'a'.repeat(40), short: 'aaaaaaa', headline: 'fix <b>', author: 'octocat', at: '2026-10-01T09:00:00Z', url: 'https://github.com/o/r/commit/a' }],
    }));
    node_assert_1.default.ok(out.includes('Showing the first 0 of 230 events.'));
    node_assert_1.default.ok(out.includes('Showing the first 1 of 130 commits.'));
    node_assert_1.default.ok(out.includes('130 commits'));
    node_assert_1.default.ok(out.includes('fix &lt;b&gt;'));
});
(0, node_test_1.default)('sidebar: reviewers with verdicts, a pending request, labels, milestone, assignees; empty states', () => {
    const out = html.pullPageHtml(page({ reviewers: [
            { login: 'ann', avatar: '', state: 'approved' }, { login: 'core', avatar: '', state: 'pending' },
        ] }));
    node_assert_1.default.match(out, /ann[^]*rv-approved/);
    node_assert_1.default.match(out, /core[^]*requested/);
    node_assert_1.default.ok(out.includes('gh-label') && out.includes('bug'));
    node_assert_1.default.ok(out.includes('v1'));
    const bare = html.pullPageHtml(page({ reviewers: [], labels: [], milestone: null, assignees: [] }));
    node_assert_1.default.ok(bare.includes('No reviewers') && bare.includes('No milestone') && bare.includes('No one') && bare.includes('None yet'));
});
(0, node_test_1.default)('the header offers check out, open on GitHub and refresh', () => {
    const out = html.pullPageHtml(page());
    for (const act of ['checkout', 'open-github', 'refresh'])
        node_assert_1.default.ok(out.includes(`data-act="${act}"`), act);
});
const actions = (over = {}) => ({ ...page().actions, ...over });
(0, node_test_1.default)('actions row: an open PR offers review, merge, convert to draft and close', () => {
    const out = html.pullActionsHtml(page());
    for (const act of ['review', 'merge', 'draft', 'close'])
        node_assert_1.default.ok(out.includes(`data-act="${act}"`), act);
    node_assert_1.default.ok(out.includes('class="btn btn-primary" data-act="merge">'), 'merge is the primary button and enabled');
    node_assert_1.default.ok(out.includes('Ready to merge.'));
});
(0, node_test_1.default)('actions row: a disabled merge says why; the hint is escaped', () => {
    const out = html.pullActionsHtml(page({ actions: actions({ merge: { enabled: false, hint: '<b>conflicts</b>', methods: ['MERGE'] } }) }));
    node_assert_1.default.match(out, /data-act="merge" disabled>/);
    node_assert_1.default.ok(!out.includes('<b>conflicts</b>') && out.includes('&lt;b&gt;conflicts&lt;/b&gt;'));
});
(0, node_test_1.default)('actions row: a pending review shows its comment count; a draft offers ready for review', () => {
    node_assert_1.default.ok(html.pullActionsHtml(page({ actions: actions({ review: { available: true, canApprove: true, pending: 3 } }) })).includes('Finish review (3)'));
    const draft = html.pullActionsHtml(page({ draft: true, actions: actions({ draft: 'ready', merge: { enabled: false, hint: 'Mark this as ready for review to merge it.', methods: ['MERGE'] } }) }));
    node_assert_1.default.ok(draft.includes('data-act="ready"') && draft.includes('Ready for review'));
    node_assert_1.default.ok(!draft.includes('data-act="draft"'));
});
(0, node_test_1.default)('actions row: closed offers reopen only; merged and read-only viewers get no row', () => {
    const closed = html.pullActionsHtml(page({ state: 'closed', actions: actions({
            review: { available: false, canApprove: false, pending: null }, merge: { enabled: false, hint: '', methods: ['MERGE'] }, state: 'reopen', draft: null
        }) }));
    node_assert_1.default.ok(closed.includes('data-act="reopen"'));
    for (const act of ['merge', 'review', 'close', 'draft'])
        node_assert_1.default.ok(!closed.includes(`data-act="${act}"`), act);
    const nothing = html.pullActionsHtml(page({ state: 'merged', actions: actions({
            review: { available: false, canApprove: false, pending: null }, merge: { enabled: false, hint: '', methods: [] }, state: null, draft: null
        }) }));
    node_assert_1.default.strictEqual(nothing, '');
});
(0, node_test_1.default)('the page carries the actions row, and no longer claims reviewing and merging happen on GitHub', () => {
    const out = html.pullPageHtml(page());
    node_assert_1.default.ok(out.includes('class="pr-actions"'));
    node_assert_1.default.ok(!out.includes('reviewing and merging happen on GitHub'));
});
(0, node_test_1.default)('withBodies applies the sanitizer to the description, comments and reviews, and leaves the input alone', () => {
    const input = page({ bodyHTML: 'D', timeline: [
            { kind: 'comment', author: user, at: 'x', bodyHTML: 'C', url: 'u' },
            { kind: 'review', author: user, at: 'x', verdict: 'approved', bodyHTML: 'R', url: 'u', comments: 0 },
            { kind: 'event', at: 'x', actor: 'a', event: 'closed' },
        ] });
    const out = html.withBodies(input, h => `[${h}]`);
    node_assert_1.default.strictEqual(out.bodyHTML, '[D]');
    node_assert_1.default.deepStrictEqual(out.timeline.map((t) => t.bodyHTML), ['[C]', '[R]', undefined]);
    node_assert_1.default.strictEqual(input.bodyHTML, 'D');
    node_assert_1.default.strictEqual(input.timeline[0].bodyHTML, 'C');
});
//# sourceMappingURL=webviewPullDetail.test.js.map