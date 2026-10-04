'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Webview bundles are plain scripts (module: none), so load the compiled shared files into a sandbox and read
// their top-level functions off it. Built by `tsc -p tsconfig.webview-shared.json`.
const sandbox = vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname, 'webview-shared.js'), 'utf8'), sandbox);
const shared = sandbox as unknown as {
  escapeHtml(s: string): string;
  reconcile<T>(container: FakeElement, items: T[], key: (item: T) => string, render: (item: T) => FakeElement): void;
  freeTextOf(query: string): string;
  matchesLocalFilter(issue: { number: number; title: string }, query: string): boolean;
  filterPickerItems(items: Array<{ value: string; label: string; description?: string }>, text: string): Array<{ value: string }>;
};

/** Just enough of the DOM tree API for reconcile(): ordered children, insert/move, replace, remove. */
class FakeElement {
  kids: FakeElement[] = [];
  parent: FakeElement | null = null;
  constructor(readonly name: string) {}
  get children(): FakeElement[] { return this.kids; }
  get firstElementChild(): FakeElement | null { return this.kids[0] ?? null; }
  get nextElementSibling(): FakeElement | null {
    return this.parent ? this.parent.kids[this.parent.kids.indexOf(this) + 1] ?? null : null;
  }
  insertBefore(node: FakeElement, ref: FakeElement | null): FakeElement {
    if (node.parent) node.parent.kids.splice(node.parent.kids.indexOf(node), 1);
    node.parent = this;
    this.kids.splice(ref ? this.kids.indexOf(ref) : this.kids.length, 0, node);
    return node;
  }
  removeChild(node: FakeElement): FakeElement {
    this.kids.splice(this.kids.indexOf(node), 1);
    node.parent = null;
    return node;
  }
  replaceChild(node: FakeElement, old: FakeElement): FakeElement {
    this.kids.splice(this.kids.indexOf(old), 1, node);
    node.parent = this;
    old.parent = null;
    return old;
  }
}

interface Row { id: string; title: string }
const render = (r: Row): FakeElement => new FakeElement(`${r.id}:${r.title}`);
const key = (r: Row): string => r.id;
const names = (c: FakeElement): string[] => c.kids.map(k => k.name);

test('reconcile: unchanged rows keep their element across a refresh', () => {
  const c = new FakeElement('c');
  const rows = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
  shared.reconcile(c, rows, key, render);
  const [a, b] = c.kids;
  shared.reconcile(c, rows.map(r => ({ ...r })), key, render);
  assert.strictEqual(c.kids[0], a);
  assert.strictEqual(c.kids[1], b);
});

test('reconcile: a changed row is re-rendered in place, its neighbours are untouched', () => {
  const c = new FakeElement('c');
  shared.reconcile(c, [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], key, render);
  const [a, b] = c.kids;
  shared.reconcile(c, [{ id: 'a', title: 'A2' }, { id: 'b', title: 'B' }], key, render);
  assert.deepStrictEqual(names(c), ['a:A2', 'b:B']);
  assert.notStrictEqual(c.kids[0], a);
  assert.strictEqual(c.kids[1], b);
});

test('reconcile: reorders by moving existing elements, inserts new ones, removes missing ones', () => {
  const c = new FakeElement('c');
  shared.reconcile(c, [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }], key, render);
  const [a, , cc] = c.kids;
  shared.reconcile(c, [{ id: 'c', title: 'C' }, { id: 'd', title: 'D' }, { id: 'a', title: 'A' }], key, render);
  assert.deepStrictEqual(names(c), ['c:C', 'd:D', 'a:A']);
  assert.strictEqual(c.kids[0], cc);
  assert.strictEqual(c.kids[2], a);
  assert.strictEqual(c.kids.length, 3);
});

test('reconcile: removes children it did not create and skips repeated keys', () => {
  const c = new FakeElement('c');
  c.insertBefore(new FakeElement('skeleton'), null);
  shared.reconcile(c, [{ id: 'a', title: 'A' }, { id: 'a', title: 'A again' }, { id: 'b', title: 'B' }], key, render);
  assert.deepStrictEqual(names(c), ['a:A', 'b:B']);
});

test('reconcile: an empty list clears the container', () => {
  const c = new FakeElement('c');
  shared.reconcile(c, [{ id: 'a', title: 'A' }], key, render);
  shared.reconcile(c, [], key, render);
  assert.deepStrictEqual(names(c), []);
});

test('freeTextOf strips qualifiers (quoted, negated) and lowercases the rest', () => {
  assert.strictEqual(shared.freeTextOf('is:open fix Crash'), 'fix crash');
  assert.strictEqual(shared.freeTextOf('label:"good first issue" -author:bob  startup'), 'startup');
  assert.strictEqual(shared.freeTextOf('is:open'), '');
  assert.strictEqual(shared.freeTextOf('#12 "exact phrase"'), '#12 exact phrase');
});

test('matchesLocalFilter matches title and #number, ignoring qualifiers', () => {
  const issue = { number: 106, title: 'Creating issues is bugged' };
  assert.strictEqual(shared.matchesLocalFilter(issue, 'is:open label:bug'), true);
  assert.strictEqual(shared.matchesLocalFilter(issue, 'is:open BUGGED'), true);
  assert.strictEqual(shared.matchesLocalFilter(issue, '#106'), true);
  assert.strictEqual(shared.matchesLocalFilter(issue, '106'), true);
  assert.strictEqual(shared.matchesLocalFilter(issue, 'creating nothing'), false);
});

test('filterPickerItems matches label or description, case-insensitively', () => {
  const items = [
    { value: 'bug', label: 'bug', description: "Something isn't working" },
    { value: 'docs', label: 'documentation' },
  ];
  assert.deepStrictEqual(shared.filterPickerItems(items, '').map(i => i.value), ['bug', 'docs']);
  assert.deepStrictEqual(shared.filterPickerItems(items, 'WORKING').map(i => i.value), ['bug']);
  assert.deepStrictEqual(shared.filterPickerItems(items, 'doc').map(i => i.value), ['docs']);
  assert.deepStrictEqual(shared.filterPickerItems(items, 'zzz'), []);
});

test('escapeHtml escapes the five HTML-significant characters', () => {
  assert.strictEqual(shared.escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});
