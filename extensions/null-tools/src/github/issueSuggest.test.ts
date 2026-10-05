'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { matchIssues } from './issueSuggest';

const issue = (number: number, title: string, state: 'open' | 'closed' = 'open') => ({ number, title, state });

test('matchIssues with nothing typed lists the newest issues first, capped at the limit', () => {
  const out = matchIssues([issue(1, 'a'), issue(3, 'c'), issue(2, 'b')], '', 2);
  assert.deepStrictEqual(out.map(i => i.number), [3, 2]);
});

test('a typed number matches issue numbers by prefix and titles containing it', () => {
  const out = matchIssues([issue(12, 'x'), issue(120, 'y'), issue(5, 'Bump to v12'), issue(7, 'z')], '12');
  assert.deepStrictEqual(out.map(i => i.number), [120, 12, 5]);
});

test('text matches titles case-insensitively and a repeated number collapses', () => {
  const out = matchIssues([issue(4, 'Crash on START'), issue(4, 'Crash on START'), issue(6, 'other')], 'start');
  assert.deepStrictEqual(out, [{ number: 4, title: 'Crash on START', state: 'open' }]);
});

test('matchIssues keeps the state so the popup can show open and closed icons', () => {
  assert.strictEqual(matchIssues([issue(9, 'done', 'closed')], '')[0].state, 'closed');
});
