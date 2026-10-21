import assert from 'node:assert';
import test from 'node:test';
import { buildProjects, buildSection } from './widgetSections';

const rank = (rows: number[]) => [...rows].sort((a, b) => a - b);

test('all repos ok: status ok, rows merged and ranked, capped', () => {
  const { section, kept } = buildSection([{ repo: 'a/b', rows: [5, 1] }, { repo: 'c/d', rows: [3] }], new Map(), rank, 2);
  assert.deepStrictEqual(section, { status: 'ok', failed: [], items: [1, 3] });
  assert.deepStrictEqual([...kept.keys()].sort(), ['a/b', 'c/d']);
});

test('partial failure: status stays ok, the failed repo keeps its last good rows and is listed', () => {
  const previous = new Map([['c/d', [9]]]);
  const { section, kept } = buildSection([{ repo: 'a/b', rows: [1] }, { repo: 'C/D', rows: null, reason: 'offline' }], previous, rank, 10);
  assert.deepStrictEqual(section, { status: 'ok', failed: [{ repo: 'C/D', reason: 'offline' }], items: [1, 9] });
  assert.deepStrictEqual(kept.get('c/d'), [9]);
});

test('every repo failed with the same reason: the section takes that reason and keeps all rows', () => {
  const previous = new Map([['a/b', [2]], ['c/d', [4]]]);
  const { section } = buildSection([{ repo: 'a/b', rows: null, reason: 'signed_out' }, { repo: 'c/d', rows: null, reason: 'signed_out' }], previous, rank, 10);
  assert.strictEqual(section.status, 'signed_out');
  assert.deepStrictEqual(section.items, [2, 4]);
  assert.strictEqual(section.failed.length, 2);
});

test('every repo failed for different reasons: status is error', () => {
  const { section } = buildSection([{ repo: 'a/b', rows: null, reason: 'offline' }, { repo: 'c/d', rows: null, reason: 'signed_out' }], new Map(), rank, 10);
  assert.strictEqual(section.status, 'error');
});

test('a repo that is no longer configured drops its remembered rows', () => {
  const { section, kept } = buildSection([{ repo: 'a/b', rows: [1] }], new Map([['gone/x', [7]]]), rank, 10);
  assert.deepStrictEqual(section.items, [1]);
  assert.ok(!kept.has('gone/x'));
});

test('no repos configured is an empty ok section, not an error', () => {
  assert.deepStrictEqual(buildSection([], new Map(), rank, 10).section, { status: 'ok', failed: [], items: [] });
});

test('projects: pinned first, then newest, capped at 8, git status attached, ISO timestamps', () => {
  const e = (n: number, pinned = false) => ({ path: `D:\\p${n}`, label: `p${n}`, isWorkspaceFile: false, timestamp: Date.UTC(2026, 9, 21, n), pinned });
  const entries = [e(1), e(9), e(2, true), e(3), e(4), e(5), e(6), e(7), e(8)];
  const { items, status } = buildProjects(entries, new Map([['D:\\p2', { branch: 'main', dirty: true }], ['D:\\p9', null]]));
  assert.strictEqual(status, 'ok');
  assert.strictEqual(items.length, 8);
  assert.deepStrictEqual(items.slice(0, 3).map(p => p.name), ['p2', 'p9', 'p8']);
  assert.deepStrictEqual([items[0].branch, items[0].dirty, items[0].pinned, items[0].lastOpened], ['main', true, true, '2026-10-21T02:00:00.000Z']);
  assert.deepStrictEqual([items[1].branch, items[1].dirty], [null, false]);       // git failed: no branch, not dirty
});
