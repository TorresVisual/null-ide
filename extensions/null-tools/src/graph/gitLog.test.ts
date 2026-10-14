'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { LogCommit, applyStashes, formatAge, parseDecoration, parseLog, parseNameStatus } from './gitLog';

const sha = (c: string): string => c.repeat(40);
const record = (fields: string[]): string => fields.join('\x1f');

test('parseLog: a merge, a commit with awkward characters, and a root commit', () => {
  const out = [
    record([sha('a'), `${sha('b')} ${sha('c')}`, 'Ann', 'ann@x.io', '1700000000',
      'HEAD -> refs/heads/main, tag: refs/tags/v1, refs/remotes/origin/main, refs/remotes/origin/HEAD', 'Merge x']),
    record([sha('b'), sha('d'), 'Bob', 'bob@x.io', '1699999999', '', 'Fix "quotes" and \'ticks\' — ünïcode ✓']),
    record([sha('d'), '', 'Cy', 'cy@x.io', '1', '', 'root']),
  ].join('\0') + '\0';

  const commits = parseLog(out);
  assert.strictEqual(commits.length, 3);
  assert.deepStrictEqual(commits[0].parents, [sha('b'), sha('c')]);
  assert.deepStrictEqual(commits[0].refs, [
    { name: 'main', kind: 'branch', current: true },
    { name: 'v1', kind: 'tag' },
    { name: 'origin/main', kind: 'remote' },
  ]);
  assert.strictEqual(commits[1].subject, 'Fix "quotes" and \'ticks\' — ünïcode ✓');
  assert.strictEqual(commits[1].author, 'Bob');
  assert.deepStrictEqual(commits[2].parents, []);
  assert.strictEqual(commits[2].time, 1);
});

test('parseLog ignores empty and malformed records', () => {
  assert.deepStrictEqual(parseLog(''), []);
  assert.deepStrictEqual(parseLog('garbage\0\0'), []);
});

test('parseDecoration: detached HEAD, plain branches; notes, pull refs and refs/stash are ignored', () => {
  assert.deepStrictEqual(
    parseDecoration('HEAD, refs/heads/dev, refs/notes/commits, refs/pull/1/head, refs/stash'),
    [{ name: 'HEAD', kind: 'head', current: true }, { name: 'dev', kind: 'branch', current: false }],
  );
  assert.deepStrictEqual(parseDecoration(''), []);
});

function commit(shaValue: string, parents: string[], subject: string): LogCommit {
  return { sha: shaValue, parents, author: 'a', email: 'e', time: 1, refs: [], subject };
}

test('applyStashes labels stashes by position, keeps the first parent and drops index/untracked commits', () => {
  const base = sha('1');
  const commits = [
    commit(sha('s'), [base, sha('i'), sha('u')], 'On main: wip'),
    commit(sha('i'), [base], 'index on main'),
    commit(sha('u'), [], 'untracked files on main'),
    commit(base, [], 'base'),
    commit(sha('t'), [base, sha('j')], 'On main: older'),
    commit(sha('j'), [base], 'index on main'),
  ];
  const out = applyStashes(commits, [
    { sha: sha('s'), parents: [base, sha('i'), sha('u')] },
    { sha: sha('t'), parents: [base, sha('j')] },
  ]);
  assert.deepStrictEqual(out.map((c) => c.sha), [sha('s'), base, sha('t')]);
  assert.deepStrictEqual(out[0].parents, [base]);
  assert.deepStrictEqual(out[0].refs, [{ name: 'stash@{0}', kind: 'stash' }]);
  assert.deepStrictEqual(out[2].refs, [{ name: 'stash@{1}', kind: 'stash' }]);
});

test('applyStashes with no stashes returns the commits unchanged', () => {
  const commits = [commit(sha('a'), [], 'x')];
  assert.deepStrictEqual(applyStashes(commits, []), commits);
});

test('parseNameStatus: spaces, unicode, a leading dash, renames', () => {
  assert.deepStrictEqual(
    parseNameStatus('M\0a b.txt\0A\0dir/é.txt\0R100\0old.txt\0new.txt\0D\0-dash.txt\0'),
    [
      { status: 'M', path: 'a b.txt' },
      { status: 'A', path: 'dir/é.txt' },
      { status: 'R', oldPath: 'old.txt', path: 'new.txt' },
      { status: 'D', path: '-dash.txt' },
    ],
  );
  assert.deepStrictEqual(parseNameStatus(''), []);
});

test('formatAge', () => {
  const now = 10_000_000;
  const ago = (s: number): string => formatAge(now - s, now);
  assert.strictEqual(ago(30), 'now');
  assert.strictEqual(ago(300), '5m');
  assert.strictEqual(ago(7200), '2h');
  assert.strictEqual(ago(3 * 86400), '3d');
  assert.strictEqual(ago(21 * 86400), '3w');
  assert.strictEqual(ago(90 * 86400), '3mo');
  assert.strictEqual(ago(800 * 86400), '2y');
  assert.strictEqual(formatAge(now + 500, now), 'now');
});
