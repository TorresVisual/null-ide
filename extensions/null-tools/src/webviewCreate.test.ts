'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// The New issue form's HTML builders are plain top-level functions in a `module: none` bundle; load the compiled
// bundle into a sandbox (built by `tsc -p tsconfig.webview-shared.json`) like webviewDetail.test.ts does.
const sandbox = vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname, 'webview-shared.js'), 'utf8'), sandbox);

const html = sandbox as unknown as {
  templateChooserHtml(templates: unknown[]): string;
  createSidebarHtml(state: unknown, meta: unknown): string;
};

const emptyState = { assignees: [], labels: [], type: null, milestone: null, parent: null };
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

test('templateChooserHtml lists each template with its about text, then a Blank issue card', () => {
  const out = html.templateChooserHtml([
    { name: 'Bug report', about: 'Something broke', title: '', body: '', labels: [] },
    { name: 'Feature', about: '', title: '', body: '', labels: [] },
  ]);
  assert.ok(out.includes('data-index="0"') && out.includes('Bug report') && out.includes('Something broke'));
  assert.ok(out.includes('data-index="1"') && out.includes('Feature'));
  assert.ok(out.includes('data-index="-1"') && out.includes('Blank issue'));
  assert.strictEqual(count(out, 'class="template-card"'), 3);
});

test('templateChooserHtml with no templates is just the Blank card', () => {
  assert.strictEqual(count(html.templateChooserHtml([]), 'class="template-card"'), 1);
});

test('templateChooserHtml escapes template names and descriptions from the repo', () => {
  const out = html.templateChooserHtml([{ name: '<img src=x onerror=1>', about: '"><script>', title: '', body: '', labels: [] }]);
  assert.ok(!out.includes('<img') && !out.includes('<script>'));
  assert.ok(out.includes('&lt;img') && out.includes('&lt;script&gt;'));
});

test('createSidebarHtml shows the empty states and an edit gear for every section', () => {
  const out = html.createSidebarHtml(emptyState, { types: [{ id: 'T', name: 'Bug' }] });
  for (const key of ['assignees', 'labels', 'type', 'milestone', 'parent']) {
    assert.ok(out.includes(`data-act="pick-${key}"`), key);
  }
  assert.ok(out.includes('No one') && out.includes('None yet') && out.includes('No type') && out.includes('No milestone'));
});

test('createSidebarHtml shows Type only for repos that have issue types', () => {
  assert.ok(!html.createSidebarHtml(emptyState, { types: [] }).includes('data-sec="type"'));
  assert.ok(!html.createSidebarHtml(emptyState, null).includes('data-sec="type"'));
});

test('createSidebarHtml shows what was chosen, escaped', () => {
  const out = html.createSidebarHtml({
    assignees: [{ login: 'a<b', avatar_url: '' }],
    labels: [{ name: '"><x', color: 'd73a4a' }],
    type: { id: 'T', name: '<i>Bug</i>' },
    milestone: { number: 2, title: '<b>v1</b>' },
    parent: { number: 3, title: '<script>' },
  }, { types: [{ id: 'T', name: 'Bug' }] });
  assert.ok(!out.includes('<script>') && !out.includes('<i>Bug') && !out.includes('<b>v1'));
  assert.ok(out.includes('a&lt;b') && out.includes('&lt;script&gt;') && out.includes('#3'));
  assert.ok(!out.includes('No one'));
});
