import assert from 'node:assert';
import test from 'node:test';
import { parseRepos, REPO_RE } from './widgetTypes';
import { WIDGET_QUERY, WidgetData, chunkRepos, mapIssues, mapPrs, rankIssues, rankPrs, searchStrings } from './widgetQueries';

const pr = (over: Record<string, unknown>) => ({
  number: 1, title: 't', url: 'https://github.com/o/r/pull/1', updatedAt: '2026-10-21T10:00:00Z', isDraft: false,
  mergeable: 'MERGEABLE', reviewDecision: null, repository: { nameWithOwner: 'o/r' }, author: { login: 'me' },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }, ...over,
});
const issue = (over: Record<string, unknown>) => ({
  number: 1, title: 'i', url: 'https://github.com/o/r/issues/1', updatedAt: '2026-10-21T10:00:00Z',
  repository: { nameWithOwner: 'o/r' }, labels: { nodes: [{ name: 'bug' }] }, assignees: { nodes: [{ login: 'me' }] }, ...over,
});
const data = (d: Partial<Record<keyof WidgetData, unknown[]>>): WidgetData => ({
  assigned: { nodes: d.assigned ?? [] }, mentioned: { nodes: d.mentioned ?? [] },
  authored: { nodes: d.authored ?? [] }, reviewReq: { nodes: d.reviewReq ?? [] },
}) as unknown as WidgetData;

test('parseRepos keeps only well-formed owner/name entries and de-duplicates', () => {
  const out = parseRepos([
    { repo: 'a/b', account: 'x' }, { repo: 'A/B', account: 'x' },          // duplicate, different case
    { repo: 'a/b is:private', account: 'x' }, { repo: '../x', account: 'x' }, { repo: 'a/b', account: '' },
    { repo: 5, account: 'x' }, null, 'a/b', { repo: 'c/d', account: 'y' },
  ]);
  assert.deepStrictEqual(out, [{ repo: 'a/b', account: 'x' }, { repo: 'c/d', account: 'y' }]);
  assert.deepStrictEqual(parseRepos('nope'), []);
  assert.ok(REPO_RE.test('o/r.js-x_1') && !REPO_RE.test('o/r/x') && !REPO_RE.test('o /r'));
});

test('search strings scope to the repos and use the viewer qualifiers from the spec', () => {
  const s = searchStrings(['a/b', 'c/d']);
  assert.strictEqual(s.assigned, 'repo:a/b repo:c/d is:issue is:open assignee:@me sort:updated-desc');
  assert.ok(s.mentioned.includes('mentions:@me') && s.authored.includes('is:pr is:open author:@me') && s.reviewReq.includes('review-requested:@me'));
  assert.ok(WIDGET_QUERY.includes('mergeable') && WIDGET_QUERY.includes('reviewDecision'));
});

test('chunking keeps every search under GitHub\'s 256 character limit', () => {
  const repos = Array.from({ length: 12 }, (_, i) => `organisation/repository-${i}`);
  const chunks = chunkRepos(repos);
  assert.deepStrictEqual(chunks.flat(), repos);
  for (const c of chunks) for (const q of Object.values(searchStrings(c))) assert.ok(q.length <= 256, `${q.length}`);
  const longest = `${'o'.repeat(100)}/${'r'.repeat(100)}`;
  assert.deepStrictEqual(chunkRepos([longest, 'a/b']), [[longest], ['a/b']]);   // an over-budget repo gets a chunk of its own
});

test('issues: assigned wins over mentioned, duplicates collapse, local checkout is attached', () => {
  const rows = mapIssues(data({ assigned: [issue({ number: 1 })], mentioned: [issue({ number: 1 }), issue({ number: 2, assignees: { nodes: [] } })] }),
    new Map([['o/r', 'D:\\code\\r']]));
  assert.deepStrictEqual(rows.map(r => [r.number, r.attention, r.assignee, r.localPath]), [[1, 'assigned', 'me', 'D:\\code\\r'], [2, 'mentioned', null, 'D:\\code\\r']]);
  assert.deepStrictEqual(rows[0].labels, ['bug']);
  assert.strictEqual(mapIssues(data({ assigned: [{}] }), new Map()).length, 0);              // search noise ({}) is skipped
});

test('PRs: review requested of the viewer, drafts of others dropped, checks and conflicts mapped', () => {
  const rows = mapPrs(data({
    authored: [pr({ number: 1, isDraft: true, mergeable: 'CONFLICTING', reviewDecision: 'CHANGES_REQUESTED',
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } })],
    reviewReq: [pr({ number: 2, author: { login: 'sam' } }), pr({ number: 3, isDraft: true, author: { login: 'sam' } }), pr({ number: 1 })],
  }), new Map());
  assert.deepStrictEqual(rows.map(r => r.number), [1, 2]);                                   // own draft kept, sam's draft dropped, #1 once
  const p1 = rows.find(r => r.number === 1)!, p2 = rows.find(r => r.number === 2)!;
  assert.deepStrictEqual([p1.review, p1.checks, p1.conflict], ['requested', 'failing', true]);   // requested overrides CHANGES_REQUESTED
  assert.deepStrictEqual([p2.review, p2.checks, p2.conflict, p2.author], ['requested', 'passing', false, 'sam']);
  const own = mapPrs(data({ authored: [pr({ reviewDecision: 'APPROVED' })] }), new Map())[0];
  assert.strictEqual(own.review, 'approved');
  assert.strictEqual(mapPrs(data({ authored: [pr({ reviewDecision: 'REVIEW_REQUIRED', commits: { nodes: [] } })] }), new Map())[0].review, 'none');
});

test('PR ranking: review requested, then changes requested, failing checks, conflicts, then recency', () => {
  const mk = (n: number, o: Partial<ReturnType<typeof mapPrs>[number]>) => ({ provider: 'github', repo: 'o/r', number: n, title: '', url: '', author: 'me', review: 'none',
    checks: 'passing', conflict: false, localPath: null, updatedAt: `2026-10-21T0${n}:00:00Z`, ...o }) as ReturnType<typeof mapPrs>[number];
  const ranked = rankPrs([mk(1, {}), mk(2, { conflict: true }), mk(3, { checks: 'failing' }), mk(4, { review: 'changes' }), mk(5, { review: 'requested' }), mk(6, {})]);
  assert.deepStrictEqual(ranked.map(r => r.number), [5, 4, 3, 2, 6, 1]);
});

test('issue ranking: assigned before mentioned, newest first inside each', () => {
  const mk = (n: number, a: 'assigned' | 'mentioned') => ({ provider: 'github', repo: 'o/r', number: n, title: '', url: '', state: 'open', labels: [], assignee: null,
    attention: a, localPath: null, updatedAt: `2026-10-21T0${n}:00:00Z` }) as ReturnType<typeof mapIssues>[number];
  assert.deepStrictEqual(rankIssues([mk(1, 'mentioned'), mk(2, 'assigned'), mk(3, 'mentioned'), mk(4, 'assigned')]).map(r => r.number), [4, 2, 3, 1]);
});
