'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// The pull request tab's HTML builders are plain top-level functions in a `module: none` bundle: load the compiled
// shared bundle (built by `tsc -p tsconfig.webview-shared.json`) into a sandbox, like webviewDetail.test.ts does.
const sandbox = vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname, 'webview-shared.js'), 'utf8'), sandbox);

type Obj = Record<string, any>;
const html = sandbox as unknown as {
  pullPageHtml(p: Obj): string;
  pullActionsHtml(p: Obj): string;
  withBodies(p: Obj, fn: (h: string) => string): Obj;
  checkSummary(checks: Obj[]): string;
};

const user = { login: 'octocat', avatar: 'https://avatars.githubusercontent.com/u/1?v=4' };
const page = (over: Obj = {}): Obj => ({
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
const check = (over: Obj = {}): Obj => ({ name: 'test', state: 'success', url: 'https://github.com/o/r/actions/runs/1', runId: 1, description: '', ...over });

test('title, branches and author are escaped', () => {
  const out = html.pullPageHtml(page({
    title: '<img src=x onerror=alert(1)>', headRef: '<b>h</b>', baseRef: 'a"b', author: { login: '<i>me</i>', avatar: '' },
  }));
  assert.ok(!out.includes('<img src=x'), 'title');
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!out.includes('<b>h</b>') && out.includes('&lt;b&gt;h&lt;/b&gt;'), 'branch');
  assert.ok(!out.includes('<i>me</i>'), 'author');
});

test('state badge: open, draft, merged, closed', () => {
  const badge = (tone: string, text: string): RegExp => new RegExp(`class="state-badge ${tone}">.*?</svg> ${text}</span>`, 's');
  assert.match(html.pullPageHtml(page()), badge('state-open', 'Open'));
  assert.match(html.pullPageHtml(page({ draft: true })), badge('state-not-planned', 'Draft'));
  const merged = html.pullPageHtml(page({ state: 'merged' }));
  assert.match(merged, badge('state-completed', 'Merged'));
  assert.ok(merged.includes(' merged <code>'));
  assert.match(html.pullPageHtml(page({ state: 'closed' })), badge('state-closed', 'Closed'));
});

test('a draft that is already merged shows its real state', () => {
  assert.match(html.pullPageHtml(page({ state: 'merged', draft: true })), /class="state-badge state-completed">/);
});

test('the description is shown, or a hint when empty', () => {
  assert.ok(html.pullPageHtml(page()).includes('<p>Hello</p>'));
  assert.ok(html.pullPageHtml(page({ bodyHTML: '' })).includes('No description provided.'));
});

test('checks section: absent without checks; failing first; summary; re-run only for a failed row that has a run', () => {
  assert.ok(!html.pullPageHtml(page()).includes('class="checks"'));

  // The host model sorts failures first; the page renders the rows in the order it is given.
  const rows = [check({ name: 'unit', state: 'failure', runId: 7 }), check({ name: 'build', state: 'pending', runId: null }), check({ name: 'lint', state: 'success' })];
  const out = html.pullPageHtml(page({ checks: rows, checksTotal: 3 }));
  assert.ok(out.includes('class="checks"'));
  assert.ok(out.indexOf('unit') < out.indexOf('build') && out.indexOf('build') < out.indexOf('lint'));
  assert.ok(out.includes('1 failing, 1 in progress, 1 successful'));
  assert.ok(out.includes('data-act="rerun"'));

  const noRun = html.pullPageHtml(page({ checks: [check({ state: 'failure', runId: null })], checksTotal: 1 }));
  assert.ok(!noRun.includes('data-act="rerun"'), 'a failed legacy status has no run to re-run');
  const allGood = html.pullPageHtml(page({ checks: [check()], checksTotal: 1 }));
  assert.ok(!allGood.includes('data-act="rerun"'), 'nothing failed');
});

test('checks: names and links are escaped, and more checks than shown are admitted', () => {
  const out = html.pullPageHtml(page({
    checks: [check({ name: '<script>x</script>', url: 'https://x/?a="b"', description: '<i>d</i>' })], checksTotal: 150,
  }));
  assert.ok(!out.includes('<script>x') && !out.includes('<i>d</i>'));
  assert.ok(out.includes('href="https://x/?a=&quot;b&quot;"'));
  assert.ok(out.includes('Showing 1 of 150 checks.'));
});

test('checkSummary names only non-empty groups', () => {
  assert.strictEqual(html.checkSummary([check(), check({ state: 'neutral' }), check({ state: 'neutral' })]), '1 successful, 2 skipped');
  assert.strictEqual(html.checkSummary([]), '');
});

test('timeline: a bodiless review is one compact row; a review with a body is a card; comments and events', () => {
  const out = html.pullPageHtml(page({ timelineTotal: 4, timeline: [
    { kind: 'review', author: { login: 'rev', avatar: '' }, at: '2026-10-02T10:00:00Z', verdict: 'approved', bodyHTML: '', url: 'https://github.com/o/r/pull/12#r1', comments: 2 },
    { kind: 'review', author: { login: 'pick', avatar: '' }, at: '2026-10-02T11:00:00Z', verdict: 'changes', bodyHTML: '<p>please fix</p>', url: 'https://github.com/o/r/pull/12#r2', comments: 0 },
    { kind: 'comment', author: { login: 'talker', avatar: '' }, at: '2026-10-02T12:00:00Z', bodyHTML: '<p>nice</p>', url: 'u' },
    { kind: 'event', at: '2026-10-03T10:00:00Z', actor: 'maint', event: 'merged' },
  ] }));
  assert.match(out, /tl-event[^]*rev<\/b> approved these changes with 2 inline comments/);
  assert.ok(out.includes('<p>please fix</p>'), 'review body shown');
  assert.match(out, /pick<\/b><span class="post-when">requested changes/);
  assert.ok(out.includes('<p>nice</p>'));
  assert.match(out, /maint<\/b> merged this/);
  assert.ok(!out.includes('Showing the first'), 'nothing is cut off');
});

test('truncation: more events than shown, and more commits than shown, are admitted', () => {
  const out = html.pullPageHtml(page({
    timelineTotal: 230,
    commitTotal: 130,
    commits: [{ sha: 'a'.repeat(40), short: 'aaaaaaa', headline: 'fix <b>', author: 'octocat', at: '2026-10-01T09:00:00Z', url: 'https://github.com/o/r/commit/a' }],
  }));
  assert.ok(out.includes('Showing the first 0 of 230 events.'));
  assert.ok(out.includes('Showing the first 1 of 130 commits.'));
  assert.ok(out.includes('130 commits'));
  assert.ok(out.includes('fix &lt;b&gt;'));
});

test('sidebar: reviewers with verdicts, a pending request, labels, milestone, assignees; empty states', () => {
  const out = html.pullPageHtml(page({ reviewers: [
    { login: 'ann', avatar: '', state: 'approved' }, { login: 'core', avatar: '', state: 'pending' },
  ] }));
  assert.match(out, /ann[^]*rv-approved/);
  assert.match(out, /core[^]*requested/);
  assert.ok(out.includes('gh-label') && out.includes('bug'));
  assert.ok(out.includes('v1'));
  const bare = html.pullPageHtml(page({ reviewers: [], labels: [], milestone: null, assignees: [] }));
  assert.ok(bare.includes('No reviewers') && bare.includes('No milestone') && bare.includes('No one') && bare.includes('None yet'));
});

test('the header offers check out, open on GitHub and refresh', () => {
  const out = html.pullPageHtml(page());
  for (const act of ['checkout', 'open-github', 'refresh']) assert.ok(out.includes(`data-act="${act}"`), act);
});

const actions = (over: Obj = {}): Obj => ({ ...page().actions, ...over });

test('actions row: an open PR offers review, merge, convert to draft and close', () => {
  const out = html.pullActionsHtml(page());
  for (const act of ['review', 'merge', 'draft', 'close']) assert.ok(out.includes(`data-act="${act}"`), act);
  assert.ok(out.includes('class="btn btn-primary" data-act="merge">'), 'merge is the primary button and enabled');
  assert.ok(out.includes('Ready to merge.'));
});

test('actions row: a disabled merge says why; the hint is escaped', () => {
  const out = html.pullActionsHtml(page({ actions: actions({ merge: { enabled: false, hint: '<b>conflicts</b>', methods: ['MERGE'] } }) }));
  assert.match(out, /data-act="merge" disabled>/);
  assert.ok(!out.includes('<b>conflicts</b>') && out.includes('&lt;b&gt;conflicts&lt;/b&gt;'));
});

test('actions row: a pending review shows its comment count; a draft offers ready for review', () => {
  assert.ok(html.pullActionsHtml(page({ actions: actions({ review: { available: true, canApprove: true, pending: 3 } }) })).includes('Finish review (3)'));
  const draft = html.pullActionsHtml(page({ draft: true, actions: actions({ draft: 'ready', merge: { enabled: false, hint: 'Mark this as ready for review to merge it.', methods: ['MERGE'] } }) }));
  assert.ok(draft.includes('data-act="ready"') && draft.includes('Ready for review'));
  assert.ok(!draft.includes('data-act="draft"'));
});

test('actions row: closed offers reopen only; merged and read-only viewers get no row', () => {
  const closed = html.pullActionsHtml(page({ state: 'closed', actions: actions({
    review: { available: false, canApprove: false, pending: null }, merge: { enabled: false, hint: '', methods: ['MERGE'] }, state: 'reopen', draft: null }) }));
  assert.ok(closed.includes('data-act="reopen"'));
  for (const act of ['merge', 'review', 'close', 'draft']) assert.ok(!closed.includes(`data-act="${act}"`), act);
  const nothing = html.pullActionsHtml(page({ state: 'merged', actions: actions({
    review: { available: false, canApprove: false, pending: null }, merge: { enabled: false, hint: '', methods: [] }, state: null, draft: null }) }));
  assert.strictEqual(nothing, '');
});

test('the page carries the actions row, and no longer claims reviewing and merging happen on GitHub', () => {
  const out = html.pullPageHtml(page());
  assert.ok(out.includes('class="pr-actions"'));
  assert.ok(!out.includes('reviewing and merging happen on GitHub'));
});

test('withBodies applies the sanitizer to the description, comments and reviews, and leaves the input alone', () => {
  const input = page({ bodyHTML: 'D', timeline: [
    { kind: 'comment', author: user, at: 'x', bodyHTML: 'C', url: 'u' },
    { kind: 'review', author: user, at: 'x', verdict: 'approved', bodyHTML: 'R', url: 'u', comments: 0 },
    { kind: 'event', at: 'x', actor: 'a', event: 'closed' },
  ] });
  const out = html.withBodies(input, h => `[${h}]`);
  assert.strictEqual(out.bodyHTML, '[D]');
  assert.deepStrictEqual(out.timeline.map((t: Obj) => t.bodyHTML), ['[C]', '[R]', undefined]);
  assert.strictEqual(input.bodyHTML, 'D');
  assert.strictEqual(input.timeline[0].bodyHTML, 'C');
});
