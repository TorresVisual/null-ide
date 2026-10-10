'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { gitLogArgs, parseGitLog } from '../gitLog';
import { ALL_TIME } from '../stats';

const EMAIL = 'me@example.com';
const range = { from: Date.parse('2026-10-05T00:00:00Z'), to: Date.parse('2026-10-12T00:00:00Z') };
const sec = (iso: string) => Date.parse(iso) / 1000;
/** What `--format=@%ct%x09%ae` prints for one commit: header, blank line, numstat lines. */
const commit = (iso: string, email: string, ...stats: string[]) => `@${sec(iso)}\t${email}\n\n${stats.join('\n')}\n`;
const ZERO = { commits: 0, filesChanged: 0, linesAdded: 0, linesRemoved: 0 };

test('sums commits and lines; a file touched twice counts once', () => {
  const out = commit('2026-10-06T10:00:00Z', EMAIL, '3\t1\ta.ts', '2\t0\tb.ts') + commit('2026-10-07T10:00:00Z', EMAIL, '5\t2\ta.ts');
  assert.deepStrictEqual(parseGitLog(out, EMAIL, range), { commits: 2, filesChanged: 2, linesAdded: 10, linesRemoved: 3 });
});

test('author match is exact and case-insensitive; other authors contribute nothing', () => {
  const out =
    commit('2026-10-06T10:00:00Z', 'ME@Example.com', '1\t0\ta.ts') +
    commit('2026-10-06T11:00:00Z', 'xme@example.com', '100\t100\tb.ts') +
    commit('2026-10-06T12:00:00Z', 'me@example.com.au', '100\t100\tc.ts');
  assert.deepStrictEqual(parseGitLog(out, EMAIL, range), { commits: 1, filesChanged: 1, linesAdded: 1, linesRemoved: 0 });
});

test('range is half-open: a commit at `from` counts, one at `to` does not', () => {
  const out = commit('2026-10-05T00:00:00Z', EMAIL, '1\t0\ta.ts') + commit('2026-10-12T00:00:00Z', EMAIL, '1\t0\tb.ts') + commit('2026-10-04T23:59:59Z', EMAIL, '1\t0\tc.ts');
  assert.deepStrictEqual(parseGitLog(out, EMAIL, range), { commits: 1, filesChanged: 1, linesAdded: 1, linesRemoved: 0 });
});

test('binary files count as a changed file but add no lines', () => {
  const out = commit('2026-10-06T10:00:00Z', EMAIL, '-\t-\tlogo.png', '4\t1\ta.ts');
  assert.deepStrictEqual(parseGitLog(out, EMAIL, range), { commits: 1, filesChanged: 2, linesAdded: 4, linesRemoved: 1 });
});

test('paths with spaces and CRLF line endings', () => {
  const out = commit('2026-10-06T10:00:00Z', EMAIL, '2\t0\tmy docs/read me.md', '1\t1\tunicodé/ü.ts').replace(/\n/g, '\r\n');
  assert.deepStrictEqual(parseGitLog(out, EMAIL, range), { commits: 1, filesChanged: 2, linesAdded: 3, linesRemoved: 1 });
});

test('empty output, garbage and torn lines give zeros and never throw', () => {
  assert.deepStrictEqual(parseGitLog('', EMAIL, range), ZERO);
  assert.deepStrictEqual(parseGitLog('warning: something\nnot a header\n', EMAIL, range), ZERO);
  assert.deepStrictEqual(parseGitLog('@nonsense\tme@example.com\n1\t0\ta.ts\n', EMAIL, range), ZERO);
  const torn = commit('2026-10-06T10:00:00Z', EMAIL, '1\t0\ta.ts') + '@1790';
  assert.deepStrictEqual(parseGitLog(torn, EMAIL, range), { commits: 1, filesChanged: 1, linesAdded: 1, linesRemoved: 0 });
});

test('gitLogArgs: bounded range adds --since/--until in seconds, ALL_TIME adds neither', () => {
  const bounded = gitLogArgs(range, EMAIL);
  assert.ok(bounded.includes(`--since=${sec('2026-10-05T00:00:00Z')}`));
  assert.ok(bounded.includes(`--until=${sec('2026-10-12T00:00:00Z')}`));
  for (const flag of ['--branches', '--no-merges', '--no-renames', '--numstat', '-F', `--author=${EMAIL}`]) assert.ok(bounded.includes(flag), flag);
  const all = gitLogArgs(ALL_TIME, EMAIL);
  assert.ok(!all.some((a) => a.startsWith('--since') || a.startsWith('--until')));
});
