'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// The composer's text helpers are plain top-level functions in a `module: none` bundle, so load the compiled
// bundle into a sandbox (built by `tsc -p tsconfig.webview-shared.json`) like webviewDetail.test.ts does.
const sandbox = vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname, 'webview-shared.js'), 'utf8'), sandbox);

interface Edit { value: string; start: number; end: number }
interface User { login: string; avatar_url: string }
const text = sandbox as unknown as {
  wrapSelection(v: string, s: number, e: number, before: string, after: string, placeholder: string): Edit;
  prefixSelectedLines(v: string, s: number, e: number, prefix: (i: number) => string): Edit;
  applyTool(tool: string, v: string, s: number, e: number): Edit | null;
  activeTrigger(v: string, caret: number): { trigger: string; prefix: string; start: number } | null;
  applySuggestion(v: string, start: number, caret: number, insert: string): Edit;
  matchUsers(users: User[], prefix: string, limit?: number): User[];
  quoteMarkdown(t: string): string;
  uploadingPlaceholder(name: string, id: number): string;
  insertAtCaret(v: string, start: number, end: number, t: string): Edit;
  replacePlaceholder(v: string, caret: number, placeholder: string, replacement: string): Edit | null;
  userSuggestion(u: User): { insert: string; html: string };
  issueSuggestion(i: { number: number; title: string; state: string }): { insert: string; html: string };
};
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const user = (login: string): User => ({ login, avatar_url: '' });

test('wrapSelection wraps the selection and keeps it selected', () => {
  assert.deepStrictEqual(plain(text.wrapSelection('a b c', 2, 3, '**', '**', 'bold text')), { value: 'a **b** c', start: 4, end: 5 });
});

test('wrapSelection with nothing selected inserts the placeholder, selected so typing replaces it', () => {
  assert.deepStrictEqual(plain(text.wrapSelection('ab', 1, 1, '_', '_', 'italic text')), { value: 'a_italic text_b', start: 2, end: 13 });
});

test('prefixSelectedLines prefixes every line the selection touches, numbering from 1', () => {
  assert.strictEqual(text.prefixSelectedLines('one\ntwo\nthree', 2, 9, i => `${i + 1}. `).value, '1. one\n2. two\n3. three');
});

test('prefixSelectedLines at the start of text that begins with a newline touches only the empty first line', () => {
  assert.strictEqual(text.prefixSelectedLines('\nabc', 0, 0, () => '- ').value, '- \nabc');
});

test('prefixSelectedLines ignores a selection that ends right after a newline (triple-click)', () => {
  assert.strictEqual(text.prefixSelectedLines('one\ntwo', 0, 4, () => '> ').value, '> one\ntwo');
});

test('applyTool covers every toolbar button and returns null for an unknown one', () => {
  const tools = vm.runInContext('COMPOSER_TOOLS', sandbox) as Array<{ id: string; key?: string }>;
  assert.strictEqual(tools.length, 9);
  for (const t of tools) assert.notStrictEqual(text.applyTool(t.id, 'a', 0, 1), null, t.id);
  const keys = tools.map(t => t.key).filter(Boolean);
  assert.strictEqual(new Set(keys).size, keys.length, 'shortcut keys must be unique');
  assert.strictEqual(text.applyTool('nope', 'a', 0, 0), null);
});

test('applyTool: heading, bullets, numbers and task list act on every selected line', () => {
  assert.strictEqual(text.applyTool('heading', 'a', 0, 1)!.value, '### a');
  assert.strictEqual(text.applyTool('ul', 'a\nb', 0, 3)!.value, '- a\n- b');
  assert.strictEqual(text.applyTool('ol', 'a\nb', 0, 3)!.value, '1. a\n2. b');
  assert.strictEqual(text.applyTool('task', 'a\nb', 0, 3)!.value, '- [ ] a\n- [ ] b');
  assert.strictEqual(text.applyTool('quote', 'a', 0, 1)!.value, '> a');
});

test('applyTool: code is inline for one line and fenced across lines', () => {
  assert.strictEqual(text.applyTool('code', 'a b', 0, 1)!.value, '`a` b');
  assert.strictEqual(text.applyTool('code', 'x\ny', 0, 3)!.value, '```\nx\ny\n```');
});

test('applyTool: link selects the url placeholder when text was selected, else the link text', () => {
  const withText = text.applyTool('link', 'see docs', 4, 8)!;
  assert.strictEqual(withText.value, 'see [docs](url)');
  assert.strictEqual(withText.value.slice(withText.start, withText.end), 'url');
  const bare = text.applyTool('link', '', 0, 0)!;
  assert.strictEqual(bare.value, '[text](url)');
  assert.strictEqual(bare.value.slice(bare.start, bare.end), 'text');
});

test('activeTrigger finds @ and # at a word start', () => {
  assert.deepStrictEqual(plain(text.activeTrigger('hi @oct', 7)), { trigger: '@', prefix: 'oct', start: 3 });
  assert.deepStrictEqual(plain(text.activeTrigger('#12', 3)), { trigger: '#', prefix: '12', start: 0 });
  assert.deepStrictEqual(plain(text.activeTrigger('see (#4', 7)), { trigger: '#', prefix: '4', start: 5 });
  assert.deepStrictEqual(plain(text.activeTrigger('a @my-user', 10)), { trigger: '@', prefix: 'my-user', start: 2 });
});

test('activeTrigger stays quiet in emails, URL fragments, headings and plain words', () => {
  assert.strictEqual(text.activeTrigger('mail me@example', 15), null);
  assert.strictEqual(text.activeTrigger('see http://x.com/#frag', 22), null);
  assert.strictEqual(text.activeTrigger('## Title', 8), null);
  assert.strictEqual(text.activeTrigger('##', 2), null);
  assert.strictEqual(text.activeTrigger('plain text', 10), null);
  assert.strictEqual(text.activeTrigger('', 0), null);
});

test('applySuggestion replaces the typed text and keeps the caret just after the mention', () => {
  const mid = text.applySuggestion('hi @oc there', 3, 6, '@octocat');
  assert.strictEqual(mid.value, 'hi @octocat there');
  assert.strictEqual(mid.start, 11);
  const end = text.applySuggestion('hi @oc', 3, 6, '@octocat');
  assert.strictEqual(end.value, 'hi @octocat ');
  assert.strictEqual(end.end, 12);
});

test('matchUsers puts prefix matches first, then substring matches, without duplicates', () => {
  const out = text.matchUsers([user('hubot'), user('octocat'), user('cato'), user('octocat'), user('zed')], 'cat');
  assert.deepStrictEqual(Array.from(out.map(u => u.login)), ['cato', 'octocat']);
  assert.strictEqual(text.matchUsers([user('a'), user('b')], '').length, 2);
  assert.strictEqual(text.matchUsers([user('a'), user('b'), user('c')], '', 2).length, 2);
});

test('quoteMarkdown quotes every line and keeps blank lines as a bare >', () => {
  assert.strictEqual(text.quoteMarkdown(' a\n\nb \n'), '> a\n>\n> b');
});

test('userSuggestion and issueSuggestion escape logins and titles', () => {
  const u = text.userSuggestion(user('a<b'));
  assert.strictEqual(u.insert, '@a<b');
  assert.ok(u.html.includes('a&lt;b'));
  const i = text.issueSuggestion({ number: 7, title: '<img src=x onerror=1>', state: 'open' });
  assert.strictEqual(i.insert, '#7');
  assert.ok(!i.html.includes('<img'));
  assert.ok(i.html.includes('&lt;img'));
});

test('uploadingPlaceholder is unique per upload and cannot break out of the image syntax', () => {
  assert.strictEqual(text.uploadingPlaceholder('image.png', 3), '![Uploading image.png…](#upload-3)');
  assert.notStrictEqual(text.uploadingPlaceholder('image.png', 3), text.uploadingPlaceholder('image.png', 4));
  assert.strictEqual(text.uploadingPlaceholder('a]b[c\nd.png', 1), '![Uploading a b c d.png…](#upload-1)');
});

test('insertAtCaret puts the stand-in on its own line and the caret just after it', () => {
  assert.deepStrictEqual(plain(text.insertAtCaret('', 0, 0, 'X')), { value: 'X', start: 1, end: 1 });
  assert.deepStrictEqual(plain(text.insertAtCaret('see:', 4, 4, 'X')), { value: 'see:\nX', start: 6, end: 6 });
  assert.deepStrictEqual(plain(text.insertAtCaret('ab', 1, 1, 'X')), { value: 'a\nX\nb', start: 3, end: 3 });
  assert.deepStrictEqual(plain(text.insertAtCaret('a\nb', 2, 2, 'X')), { value: 'a\nX\nb', start: 3, end: 3 });
  assert.deepStrictEqual(plain(text.insertAtCaret('hello world', 0, 5, 'X')), { value: 'X\n world', start: 1, end: 1 });
});

test('replacePlaceholder swaps the stand-in for the markdown and keeps the caret where the user left it', () => {
  const p = '![Uploading a.png…](#upload-1)';
  const r = '![a](https://x)';
  const before = `hi\n${p}\nbye`;
  const atEnd = text.replacePlaceholder(before, before.length, p, r)!;
  assert.strictEqual(atEnd.value, `hi\n${r}\nbye`);
  assert.strictEqual(atEnd.start, atEnd.value.length); // moved by the length difference
  assert.strictEqual(text.replacePlaceholder(before, 1, p, r)!.start, 1); // before the stand-in: untouched
  assert.strictEqual(text.replacePlaceholder(before, 5, p, r)!.start, 3 + r.length); // inside it: right after the result
});

test('replacePlaceholder with an empty replacement removes the stand-in; one the user deleted is left alone', () => {
  const p = '![Uploading a.png…](#upload-1)';
  assert.strictEqual(text.replacePlaceholder(`a${p}b`, 0, p, '')!.value, 'ab');
  assert.strictEqual(text.replacePlaceholder('the user deleted it', 3, p, 'x'), null);
});
