'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_vm_1 = __importDefault(require("node:vm"));
// The composer's text helpers are plain top-level functions in a `module: none` bundle, so load the compiled
// bundle into a sandbox (built by `tsc -p tsconfig.webview-shared.json`) like webviewDetail.test.ts does.
const sandbox = node_vm_1.default.createContext({});
node_vm_1.default.runInContext((0, node_fs_1.readFileSync)(node_path_1.default.join(__dirname, 'webview-shared.js'), 'utf8'), sandbox);
const text = sandbox;
const plain = (v) => JSON.parse(JSON.stringify(v));
const user = (login) => ({ login, avatar_url: '' });
(0, node_test_1.default)('wrapSelection wraps the selection and keeps it selected', () => {
    node_assert_1.default.deepStrictEqual(plain(text.wrapSelection('a b c', 2, 3, '**', '**', 'bold text')), { value: 'a **b** c', start: 4, end: 5 });
});
(0, node_test_1.default)('wrapSelection with nothing selected inserts the placeholder, selected so typing replaces it', () => {
    node_assert_1.default.deepStrictEqual(plain(text.wrapSelection('ab', 1, 1, '_', '_', 'italic text')), { value: 'a_italic text_b', start: 2, end: 13 });
});
(0, node_test_1.default)('prefixSelectedLines prefixes every line the selection touches, numbering from 1', () => {
    node_assert_1.default.strictEqual(text.prefixSelectedLines('one\ntwo\nthree', 2, 9, i => `${i + 1}. `).value, '1. one\n2. two\n3. three');
});
(0, node_test_1.default)('prefixSelectedLines at the start of text that begins with a newline touches only the empty first line', () => {
    node_assert_1.default.strictEqual(text.prefixSelectedLines('\nabc', 0, 0, () => '- ').value, '- \nabc');
});
(0, node_test_1.default)('prefixSelectedLines ignores a selection that ends right after a newline (triple-click)', () => {
    node_assert_1.default.strictEqual(text.prefixSelectedLines('one\ntwo', 0, 4, () => '> ').value, '> one\ntwo');
});
(0, node_test_1.default)('applyTool covers every toolbar button and returns null for an unknown one', () => {
    const tools = node_vm_1.default.runInContext('COMPOSER_TOOLS', sandbox);
    node_assert_1.default.strictEqual(tools.length, 9);
    for (const t of tools)
        node_assert_1.default.notStrictEqual(text.applyTool(t.id, 'a', 0, 1), null, t.id);
    const keys = tools.map(t => t.key).filter(Boolean);
    node_assert_1.default.strictEqual(new Set(keys).size, keys.length, 'shortcut keys must be unique');
    node_assert_1.default.strictEqual(text.applyTool('nope', 'a', 0, 0), null);
});
(0, node_test_1.default)('applyTool: heading, bullets, numbers and task list act on every selected line', () => {
    node_assert_1.default.strictEqual(text.applyTool('heading', 'a', 0, 1).value, '### a');
    node_assert_1.default.strictEqual(text.applyTool('ul', 'a\nb', 0, 3).value, '- a\n- b');
    node_assert_1.default.strictEqual(text.applyTool('ol', 'a\nb', 0, 3).value, '1. a\n2. b');
    node_assert_1.default.strictEqual(text.applyTool('task', 'a\nb', 0, 3).value, '- [ ] a\n- [ ] b');
    node_assert_1.default.strictEqual(text.applyTool('quote', 'a', 0, 1).value, '> a');
});
(0, node_test_1.default)('applyTool: code is inline for one line and fenced across lines', () => {
    node_assert_1.default.strictEqual(text.applyTool('code', 'a b', 0, 1).value, '`a` b');
    node_assert_1.default.strictEqual(text.applyTool('code', 'x\ny', 0, 3).value, '```\nx\ny\n```');
});
(0, node_test_1.default)('applyTool: link selects the url placeholder when text was selected, else the link text', () => {
    const withText = text.applyTool('link', 'see docs', 4, 8);
    node_assert_1.default.strictEqual(withText.value, 'see [docs](url)');
    node_assert_1.default.strictEqual(withText.value.slice(withText.start, withText.end), 'url');
    const bare = text.applyTool('link', '', 0, 0);
    node_assert_1.default.strictEqual(bare.value, '[text](url)');
    node_assert_1.default.strictEqual(bare.value.slice(bare.start, bare.end), 'text');
});
(0, node_test_1.default)('activeTrigger finds @ and # at a word start', () => {
    node_assert_1.default.deepStrictEqual(plain(text.activeTrigger('hi @oct', 7)), { trigger: '@', prefix: 'oct', start: 3 });
    node_assert_1.default.deepStrictEqual(plain(text.activeTrigger('#12', 3)), { trigger: '#', prefix: '12', start: 0 });
    node_assert_1.default.deepStrictEqual(plain(text.activeTrigger('see (#4', 7)), { trigger: '#', prefix: '4', start: 5 });
    node_assert_1.default.deepStrictEqual(plain(text.activeTrigger('a @my-user', 10)), { trigger: '@', prefix: 'my-user', start: 2 });
});
(0, node_test_1.default)('activeTrigger stays quiet in emails, URL fragments, headings and plain words', () => {
    node_assert_1.default.strictEqual(text.activeTrigger('mail me@example', 15), null);
    node_assert_1.default.strictEqual(text.activeTrigger('see http://x.com/#frag', 22), null);
    node_assert_1.default.strictEqual(text.activeTrigger('## Title', 8), null);
    node_assert_1.default.strictEqual(text.activeTrigger('##', 2), null);
    node_assert_1.default.strictEqual(text.activeTrigger('plain text', 10), null);
    node_assert_1.default.strictEqual(text.activeTrigger('', 0), null);
});
(0, node_test_1.default)('applySuggestion replaces the typed text and keeps the caret just after the mention', () => {
    const mid = text.applySuggestion('hi @oc there', 3, 6, '@octocat');
    node_assert_1.default.strictEqual(mid.value, 'hi @octocat there');
    node_assert_1.default.strictEqual(mid.start, 11);
    const end = text.applySuggestion('hi @oc', 3, 6, '@octocat');
    node_assert_1.default.strictEqual(end.value, 'hi @octocat ');
    node_assert_1.default.strictEqual(end.end, 12);
});
(0, node_test_1.default)('matchUsers puts prefix matches first, then substring matches, without duplicates', () => {
    const out = text.matchUsers([user('hubot'), user('octocat'), user('cato'), user('octocat'), user('zed')], 'cat');
    node_assert_1.default.deepStrictEqual(Array.from(out.map(u => u.login)), ['cato', 'octocat']);
    node_assert_1.default.strictEqual(text.matchUsers([user('a'), user('b')], '').length, 2);
    node_assert_1.default.strictEqual(text.matchUsers([user('a'), user('b'), user('c')], '', 2).length, 2);
});
(0, node_test_1.default)('quoteMarkdown quotes every line and keeps blank lines as a bare >', () => {
    node_assert_1.default.strictEqual(text.quoteMarkdown(' a\n\nb \n'), '> a\n>\n> b');
});
(0, node_test_1.default)('userSuggestion and issueSuggestion escape logins and titles', () => {
    const u = text.userSuggestion(user('a<b'));
    node_assert_1.default.strictEqual(u.insert, '@a<b');
    node_assert_1.default.ok(u.html.includes('a&lt;b'));
    const i = text.issueSuggestion({ number: 7, title: '<img src=x onerror=1>', state: 'open' });
    node_assert_1.default.strictEqual(i.insert, '#7');
    node_assert_1.default.ok(!i.html.includes('<img'));
    node_assert_1.default.ok(i.html.includes('&lt;img'));
});
(0, node_test_1.default)('uploadingPlaceholder is unique per upload and cannot break out of the image syntax', () => {
    node_assert_1.default.strictEqual(text.uploadingPlaceholder('image.png', 3), '![Uploading image.png…](#upload-3)');
    node_assert_1.default.notStrictEqual(text.uploadingPlaceholder('image.png', 3), text.uploadingPlaceholder('image.png', 4));
    node_assert_1.default.strictEqual(text.uploadingPlaceholder('a]b[c\nd.png', 1), '![Uploading a b c d.png…](#upload-1)');
});
(0, node_test_1.default)('insertAtCaret puts the stand-in on its own line and the caret just after it', () => {
    node_assert_1.default.deepStrictEqual(plain(text.insertAtCaret('', 0, 0, 'X')), { value: 'X', start: 1, end: 1 });
    node_assert_1.default.deepStrictEqual(plain(text.insertAtCaret('see:', 4, 4, 'X')), { value: 'see:\nX', start: 6, end: 6 });
    node_assert_1.default.deepStrictEqual(plain(text.insertAtCaret('ab', 1, 1, 'X')), { value: 'a\nX\nb', start: 3, end: 3 });
    node_assert_1.default.deepStrictEqual(plain(text.insertAtCaret('a\nb', 2, 2, 'X')), { value: 'a\nX\nb', start: 3, end: 3 });
    node_assert_1.default.deepStrictEqual(plain(text.insertAtCaret('hello world', 0, 5, 'X')), { value: 'X\n world', start: 1, end: 1 });
});
(0, node_test_1.default)('replacePlaceholder swaps the stand-in for the markdown and keeps the caret where the user left it', () => {
    const p = '![Uploading a.png…](#upload-1)';
    const r = '![a](https://x)';
    const before = `hi\n${p}\nbye`;
    const atEnd = text.replacePlaceholder(before, before.length, p, r);
    node_assert_1.default.strictEqual(atEnd.value, `hi\n${r}\nbye`);
    node_assert_1.default.strictEqual(atEnd.start, atEnd.value.length); // moved by the length difference
    node_assert_1.default.strictEqual(text.replacePlaceholder(before, 1, p, r).start, 1); // before the stand-in: untouched
    node_assert_1.default.strictEqual(text.replacePlaceholder(before, 5, p, r).start, 3 + r.length); // inside it: right after the result
});
(0, node_test_1.default)('replacePlaceholder with an empty replacement removes the stand-in; one the user deleted is left alone', () => {
    const p = '![Uploading a.png…](#upload-1)';
    node_assert_1.default.strictEqual(text.replacePlaceholder(`a${p}b`, 0, p, '').value, 'ab');
    node_assert_1.default.strictEqual(text.replacePlaceholder('the user deleted it', 3, p, 'x'), null);
});
(0, node_test_1.default)('uploadIdsIn finds the upload stand-ins in a text, and dropStaleUploads removes only the ones nothing is waiting for', () => {
    const live = text.uploadingPlaceholder('a.png', 4);
    const stale = text.uploadingPlaceholder('b.png', 2);
    const value = `x\n${stale}\ny\n${live}\nz`;
    node_assert_1.default.deepStrictEqual(plain(text.uploadIdsIn(value)), [2, 4]);
    node_assert_1.default.deepStrictEqual(plain(text.uploadIdsIn('no uploads here, ![img](#upload-9) is not one')), []);
    node_assert_1.default.strictEqual(text.dropStaleUploads(value, [4]), `x\ny\n${live}\nz`);
    node_assert_1.default.strictEqual(text.dropStaleUploads('plain', []), 'plain');
});
//# sourceMappingURL=webviewComposer.test.js.map