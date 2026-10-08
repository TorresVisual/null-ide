'use strict';

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

// The webview bundle is a plain script, so load the compiled shared file into a sandbox that has a
// tiny fake `document` (no jsdom) and read its top-level functions off it.
class FakeNode {
  children: FakeNode[] = [];
  attrs: Record<string, string> = {};
  constructor(readonly tag: string, readonly text?: string) {}
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  appendChild(c: FakeNode) {
    this.children.push(c);
    return c;
  }
}

const counter = { elements: 0 };
const document = {
  createElement: (tag: string) => {
    counter.elements++;
    return new FakeNode(tag);
  },
  createTextNode: (text: string) => new FakeNode('#text', text),
};
const sandbox = vm.createContext({ document });
vm.runInContext(readFileSync(path.join(__dirname, '..', 'webview-music-shared.js'), 'utf8'), sandbox);
const dom = sandbox as unknown as {
  h(tag: string, attrs?: Record<string, unknown> | null, ...children: unknown[]): FakeNode;
};

test('h() keeps markup in names inert: one element, text node child, literal attributes', () => {
  counter.elements = 0;
  const evil = '"><img src=x onerror=alert(1)>';
  const row = dom.h('li', { 'data-id': evil, title: evil }, evil);
  assert.strictEqual(counter.elements, 1);
  assert.strictEqual(row.attrs['data-id'], evil);
  assert.strictEqual(row.attrs.title, evil);
  assert.strictEqual(row.children.length, 1);
  assert.strictEqual(row.children[0].tag, '#text');
  assert.strictEqual(row.children[0].text, evil);
});

test('h() skips null/undefined/false, sets boolean attributes and nests elements', () => {
  const inner = dom.h('b', null, 'x');
  const el = dom.h('div', { hidden: true, disabled: false, title: null, 'aria-pressed': 'false' }, null, undefined, false, inner, 'tail');
  assert.deepStrictEqual(el.attrs, { hidden: '', 'aria-pressed': 'false' });
  assert.deepStrictEqual(el.children.map((c) => c.tag), ['b', '#text']);
});
