'use strict';

import assert from 'node:assert';
import test from 'node:test';
import {
  DEFAULT_FILTER, PullFilter, describeFilter, facetRows, isDefaultFilter, isSafeSearchValue, parseFilter, pullsQuery,
} from './pullFilter';

const q = (over: Partial<PullFilter> = {}): string => pullsQuery('o', 'r', { ...DEFAULT_FILTER, ...over });

test('the default filter is exactly the Phase 1 query', () => {
  assert.strictEqual(q(), 'repo:o/r is:pr is:open sort:updated-desc');
  assert.ok(isDefaultFilter(DEFAULT_FILTER));
});

test('each state maps to its qualifiers: closed excludes merged, all adds none', () => {
  assert.strictEqual(q({ state: 'merged' }), 'repo:o/r is:pr is:merged sort:updated-desc');
  assert.strictEqual(q({ state: 'closed' }), 'repo:o/r is:pr is:closed is:unmerged sort:updated-desc');
  assert.strictEqual(q({ state: 'all' }), 'repo:o/r is:pr sort:updated-desc');
});

test('mine, review requested, draft and sort', () => {
  assert.strictEqual(
    q({ mine: true, reviewRequested: true, draft: 'hide', sort: 'created' }),
    'repo:o/r is:pr is:open author:@me review-requested:@me draft:false sort:created-desc',
  );
  assert.strictEqual(q({ draft: 'only', sort: 'comments' }), 'repo:o/r is:pr is:open draft:true sort:comments-desc');
});

test('label and milestone are quoted so names with spaces stay one qualifier', () => {
  assert.strictEqual(
    q({ label: 'good first issue', milestone: 'v 1.0' }),
    'repo:o/r is:pr is:open label:"good first issue" milestone:"v 1.0" sort:updated-desc',
  );
});

test('a label that would end the quotes or start another qualifier never reaches the query', () => {
  for (const bad of ['x" is:closed', 'a\\', 'line\nbreak', 'tab\there', '', 'x'.repeat(101)]) {
    assert.strictEqual(isSafeSearchValue(bad), false, JSON.stringify(bad));
    assert.strictEqual(q({ label: bad, milestone: bad }), q(), JSON.stringify(bad));
  }
});

test('parseFilter: anything unusable falls back field by field and never throws', () => {
  for (const junk of [undefined, null, 'x', 7, [], {}]) assert.deepStrictEqual(parseFilter(junk), DEFAULT_FILTER);
  assert.deepStrictEqual(
    parseFilter({ state: 'bogus', mine: 'yes', draft: 'only', label: 'bug" x', milestone: 'v1', sort: 7 }),
    { ...DEFAULT_FILTER, draft: 'only', milestone: 'v1' },
  );
  const kept: PullFilter = { ...DEFAULT_FILTER, state: 'merged', mine: true, label: 'bug', sort: 'comments' };
  assert.deepStrictEqual(parseFilter(JSON.parse(JSON.stringify(kept))), kept);
});

test('describeFilter names only what differs from the default, and isDefaultFilter agrees', () => {
  assert.strictEqual(describeFilter(DEFAULT_FILTER), '');
  const f: PullFilter = { ...DEFAULT_FILTER, state: 'merged', mine: true, draft: 'hide', label: 'bug', sort: 'created' };
  assert.strictEqual(describeFilter(f), 'Merged · Created by me · No drafts · Label: bug · Newest');
  assert.ok(!isDefaultFilter(f));
  assert.ok(!isDefaultFilter({ ...DEFAULT_FILTER, milestone: 'v1' }));
});

test('facetRows shows the current value of every facet', () => {
  const rows = facetRows({ ...DEFAULT_FILTER, state: 'closed', reviewRequested: true, label: 'bug' });
  const by = Object.fromEntries(rows.map(r => [r.id, r.description]));
  assert.deepStrictEqual(by, {
    state: 'Closed (not merged)', mine: 'Off', reviewRequested: 'On', draft: 'Any', label: 'bug', milestone: 'Any', sort: 'Recently updated',
  });
});
