# GitHub Issues Panel v2, Phase 4 (Composer + Create flow): Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Replace the plain textareas in the Issues detail tab and the bare New issue form with one github.com-style composer (Write/Preview, toolbar, shortcuts, `@`/`#` autocomplete, drafts) and a full create flow (template chooser, title, composer, sidebar pickers for assignees/labels/type/milestone/parent, "Create more"). This finishes #106.

**Architecture:** `composerText.ts` holds the pure text edits (tested through the existing `vm` sandbox). `composer.ts` is the DOM component built on it; it asks the host for GitHub-rendered previews (`POST /markdown`) and `#` suggestions over the message channel and keeps no state the host needs. The detail tab mounts a composer for the new comment and for each open edit; the New issue tab is rewritten around the same component. Drafts live in `workspaceState` on the host, written 500 ms after the last keystroke. REST create can't set an issue type or a parent, so those two follow the create call and a failure there is reported, never fatal.

**Tech Stack:** TypeScript 5.8, VS Code extension API (`^1.85.0`), vanilla DOM webviews, GitHub REST + GraphQL, `node:test`.

**Spec:** [docs/specs/github-issues-panel-v2-design.md](../specs/github-issues-panel-v2-design.md) (this plan covers "Delivery phases → 4. Composer + create flow", the "Composer" and "Create flow (#106)" sections). Phases 1–3 are on `main`.

**Deviations from the spec's Phase 4 list** (each one is deliberate):
- **No "attach image" toolbar button, no paste/drop handling.** Images are Phase 5.
- **Esc on a changed edit asks by pressing Esc again** (an inline hint) instead of a confirm dialog: a webview can't open a modal.
- **`@` candidates come from data the webview already has** (repo assignable users ∪ the issue's participants), so no round trip. `#` asks the host: loaded issues first, then a server search when fewer than 5 match.
- **Drafts cover the new-comment box and the New issue description.** Not the title, not post edits (edits start from the saved text). `saveDraft` carries the issue number (0 = the New issue form) so a save that fires late can't land under another issue.
- **"Create more" also keeps the Parent**, not just template/labels/milestone: creating several sub-issues in a row is the main use.
- **The Parent picker lists the 50 newest open issues**, the same source as *Add sub-issue* in Phase 3.
- **Type and Parent are applied after the REST create** (GraphQL `updateIssueIssueType`, `addSubIssue`). If one fails the issue still opens and a warning names what failed.
- **`getRepoLabels` / `getAssignableUsers` and their REST calls are deleted**: the form takes everything from `getMetadata()`, which also has milestones and types.
- **`onCreated` stops being a per-call callback.** `IssueDetailPanel.configure(drafts, onCreated)` sets it once, because "Create sub-issue" now opens the form from the detail tab, which has no provider to pass one.
- Verified against live GitHub on 2026-10-04: `POST /markdown` with `mode: gfm` and `context: owner/repo` answers `200 text/html` (not JSON), so it needs its own raw request. Nothing else in this plan was run against GitHub.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Work only inside `D:\Coding\Apps\null-ide\` (CLAUDE.md scope rule). All paths below are relative to `extensions/null-tools/` unless they start with `docs/` or `CLAUDE.md`. Run all `npm`/`npx` commands from `extensions/null-tools/`.
- Edit TypeScript sources only; never hand-edit compiled output (`out/*.js`, `lib/issues.js`, `lib/issueDetail.js`, `out/webview-shared.js`). `out/` and `lib/*.js` **are tracked in git**: after `npm run compile`, stage the compiled files that belong to the task in the same commit as their source. The tree is clean before each task, so `git status --short` then `git add -A .` (from `extensions/null-tools/`) stages exactly the task's source plus its compiled output. Never stage anything else.
- Unit tests only cover files that don't `import 'vscode'` (repo convention). The main `tsconfig.json` has an explicit `include` list: every new `*.test.ts` must be added there *and* to the `test` script in `package.json`. Webview helpers are tested through `tsconfig.webview-shared.json` → `out/webview-shared.js` (see `src/webviewShared.test.ts`, `src/webviewDetail.test.ts`).
- Webview files are `module: none` scripts: no `import`/`export`. Top-level names share one global scope per bundle, so every top-level identifier must be unique across all files of a bundle. `issueDetail.ts` already declares `DOMPurify` and `acquireVsCodeApi` globally: don't redeclare them in other files.
- Objects created inside the `vm` sandbox have a different `Object.prototype`/`Array.prototype`: copy with `JSON.parse(JSON.stringify(x))` (the `plain` helper in the new tests) before `assert.deepStrictEqual`.
- No new runtime or dev dependencies. `@primer/octicons` is only downloaded into a temp dir to run the generator.
- Colors: theme variables only (`var(--vscode-*)`), no hex fallbacks in new CSS, except label colors (repo data).
- Interpolate only escaped text into webview `innerHTML`: user-controlled strings (titles, logins, template names, label names) go through `escapeHtml`. The only trusted markup is GitHub-rendered HTML (`bodyHTML`, preview), and it reaches the DOM only through `neutralizeImagesHtml` + `DOMPurify.sanitize`. `ComposerSuggestion.html` and `PickerItem.html` are markup the caller has already escaped.
- Commit messages: conventional style (`feat(null-tools): …`), ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Don't push.

## Review Focus

1. **Hostile text everywhere the composer shows other people's words.** Issue titles in the `#` popup, logins in the `@` popup, template names and `about` text, label/milestone/parent titles in the create sidebar, and the preview (GitHub HTML) must never become markup. Pinned in Task 1 (`userSuggestion`/`issueSuggestion escape…`), Task 5 (`templateChooserHtml escapes…`, `createSidebarHtml escapes…`), Task 4 (`postHtml in edit mode… never inlines the markdown source`); the preview path is checked manually in Task 8 (scenario 13).
2. **A draft landing under the wrong issue, or coming back after the issue was created or the comment posted.** The pending-save slot carries its own issue number, the host clears a draft only after the write succeeded, and the webview drops its queued save when Create is pressed. Key format pinned in Task 2 (`draftKey`); the races are manual in Task 8 (scenarios 6 and 7).
3. **A create that half-works.** The issue exists but setting the type or linking the parent failed: the issue must still open, with a warning naming what failed. Pinned in Task 2 (`runCreateExtras reports a failing step by name and still runs the rest`).
4. **`@` and `#` in places that aren't mentions.** An email (`me@example.com`), a URL fragment (`/#frag`), a markdown heading (`# Title`, `##`) and text inside a word must not open the popup. Pinned in Task 1 (`activeTrigger …`).
5. **Slow or out-of-order replies, and empty input.** A preview or `#` answer that arrives after the user switched tab or kept typing must not overwrite the newer state; an empty title, an empty comment and an all-whitespace edit must be refused with a visible message, not sent. Empty text handling is pinned in Task 2 (`matchIssues` with nothing typed) and Task 1 (`quoteMarkdown`, `activeTrigger('')`); the empty-title and empty-comment refusals are checked manually in Task 8 (scenarios 4 and 10); the reply races are checked manually in Task 8 (scenario 9).

---

### Task 1: Composer text helpers (`composerText.ts`)

**Files:**
- Create: `src/webview/composerText.ts`
- Create: `src/webviewComposer.test.ts`
- Modify: `tsconfig.webview-shared.json` (`include`), `tsconfig.webview-issue-detail.json` (`include`), `tsconfig.json` (`include`), `package.json` (`test` script)

**Interfaces:**
- Consumes (existing webview globals): `escapeHtml`, `avatarHtml(user)`, `issueStateIcon(state, reason)`, `GithubUser`.
- Produces (webview globals, all pure):
  - `interface ComposerEdit { value: string; start: number; end: number }`
  - `interface ComposerSuggestion { insert: string; html: string }`
  - `const COMPOSER_TOOLS: Array<{ id: string; icon: string; title: string; key?: string }>`
  - `applyTool(tool: string, value: string, start: number, end: number): ComposerEdit | null`
  - `wrapSelection(value, start, end, before, after, placeholder): ComposerEdit`, `prefixSelectedLines(value, start, end, prefix: (index: number) => string): ComposerEdit`, `codeSelection(value, start, end)`, `linkSelection(value, start, end)`
  - `activeTrigger(value: string, caret: number): { trigger: '@' | '#'; prefix: string; start: number } | null`
  - `applySuggestion(value, start, caret, insert): ComposerEdit`
  - `matchUsers(users: GithubUser[], prefix: string, limit?: number): GithubUser[]`
  - `quoteMarkdown(text: string): string`
  - `userSuggestion(u: GithubUser): ComposerSuggestion`, `issueSuggestion(i: { number: number; title: string; state: string }): ComposerSuggestion`

- [ ] **Step 1: Write the failing test**

Create `src/webviewComposer.test.ts`:

```ts
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
```

- [ ] **Step 2: Register the test and run it to verify it fails**

In `tsconfig.json`, add `"src/webviewComposer.test.ts"` to the `include` array (after `"src/webviewDetail.test.ts"`). In `package.json`, append ` out/webviewComposer.test.js` to the end of the `node --test …` list in the `test` script.

In `tsconfig.webview-shared.json` add `"src/webview/composerText.ts"` after `"src/webview/detailSidebarHtml.ts"` (mind the comma). In `tsconfig.webview-issue-detail.json` add `"src/webview/composerText.ts",` on the line after `"src/webview/detailTypes.ts", "src/webview/detailHtml.ts", "src/webview/detailSidebarHtml.ts",`.

Run: `npm test`
Expected: FAIL. `tsc` succeeds (the file list is valid once `composerText.ts` exists, so first create an empty placeholder: `printf "'use strict';\n" > src/webview/composerText.ts`), then `webviewComposer.test.js` fails with `text.wrapSelection is not a function` (and `ReferenceError: COMPOSER_TOOLS is not defined`).

- [ ] **Step 3: Write the implementation**

Replace `src/webview/composerText.ts` with:

```ts
'use strict';

// Pure text and markup helpers for the composer (composer.ts). No DOM, so webviewComposer.test.ts can run them in a sandbox.

/** A text change: the new full value, and where the selection should be afterwards. */
interface ComposerEdit { value: string; start: number; end: number; }

/** One row of the `@` / `#` popup. `html` is markup already escaped here; `insert` replaces the typed trigger text. */
interface ComposerSuggestion { insert: string; html: string; }

/** The toolbar, left to right. `key` is the Ctrl/Cmd shortcut. */
const COMPOSER_TOOLS: Array<{ id: string; icon: string; title: string; key?: string }> = [
  { id: 'heading', icon: 'heading', title: 'Heading' },
  { id: 'bold', icon: 'bold', title: 'Bold (Ctrl+B)', key: 'b' },
  { id: 'italic', icon: 'italic', title: 'Italic (Ctrl+I)', key: 'i' },
  { id: 'quote', icon: 'quote', title: 'Quote' },
  { id: 'code', icon: 'code', title: 'Code (Ctrl+E)', key: 'e' },
  { id: 'link', icon: 'link', title: 'Link (Ctrl+K)', key: 'k' },
  { id: 'ul', icon: 'list-unordered', title: 'Bulleted list' },
  { id: 'ol', icon: 'list-ordered', title: 'Numbered list' },
  { id: 'task', icon: 'tasklist', title: 'Task list' },
];

/** Wraps the selection in `before`/`after`; with nothing selected it inserts `placeholder` there, selected. */
function wrapSelection(
  value: string, start: number, end: number, before: string, after: string, placeholder: string,
): ComposerEdit {
  const selected = value.slice(start, end) || placeholder;
  return {
    value: value.slice(0, start) + before + selected + after + value.slice(end),
    start: start + before.length,
    end: start + before.length + selected.length,
  };
}

/** Puts `prefix(n)` in front of every line the selection touches (n counts from 0). No toggling: pressing twice nests. */
function prefixSelectedLines(
  value: string, start: number, end: number, prefix: (index: number) => string,
): ComposerEdit {
  const from = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
  // A selection that ends right after a newline (triple-click) doesn't include the next line.
  const base = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const found = value.indexOf('\n', base);
  const to = found === -1 ? value.length : found;
  const block = value.slice(from, to).split('\n').map((line, i) => prefix(i) + line).join('\n');
  return { value: value.slice(0, from) + block + value.slice(to), start: from, end: from + block.length };
}

/** Inline code for one line, a fenced block when the selection spans lines. */
function codeSelection(value: string, start: number, end: number): ComposerEdit {
  return value.slice(start, end).includes('\n')
    ? wrapSelection(value, start, end, '```\n', '\n```', 'code')
    : wrapSelection(value, start, end, '`', '`', 'code');
}

/** `[selection](url)` with `url` selected; with nothing selected, `[text](url)` with `text` selected. */
function linkSelection(value: string, start: number, end: number): ComposerEdit {
  const selected = value.slice(start, end);
  if (!selected) {
    return { value: `${value.slice(0, start)}[text](url)${value.slice(end)}`, start: start + 1, end: start + 5 };
  }
  const urlStart = start + selected.length + 3; // '[' + selected + ']('
  return { value: `${value.slice(0, start)}[${selected}](url)${value.slice(end)}`, start: urlStart, end: urlStart + 3 };
}

/** The edit a toolbar button (or its shortcut) makes; null for an unknown id. */
function applyTool(tool: string, value: string, start: number, end: number): ComposerEdit | null {
  switch (tool) {
    case 'heading': return prefixSelectedLines(value, start, end, () => '### ');
    case 'bold': return wrapSelection(value, start, end, '**', '**', 'bold text');
    case 'italic': return wrapSelection(value, start, end, '_', '_', 'italic text');
    case 'quote': return prefixSelectedLines(value, start, end, () => '> ');
    case 'code': return codeSelection(value, start, end);
    case 'link': return linkSelection(value, start, end);
    case 'ul': return prefixSelectedLines(value, start, end, () => '- ');
    case 'ol': return prefixSelectedLines(value, start, end, i => `${i + 1}. `);
    case 'task': return prefixSelectedLines(value, start, end, () => '- [ ] ');
    default: return null;
  }
}

/**
 * The `@name` / `#12` being typed at `caret`, or null. The trigger must start a word (start of text, or after
 * whitespace or `(`), so emails, URL fragments and `##` headings never match.
 */
function activeTrigger(value: string, caret: number): { trigger: '@' | '#'; prefix: string; start: number } | null {
  let i = caret;
  while (i > 0 && /[A-Za-z0-9_-]/.test(value[i - 1])) i--;
  if (i === 0) return null;
  const ch = value[i - 1];
  if (ch !== '@' && ch !== '#') return null;
  if (i - 1 > 0 && !/[\s(]/.test(value[i - 2])) return null;
  return { trigger: ch, prefix: value.slice(i, caret), start: i - 1 };
}

/** Replaces `value[start..caret]` (the trigger and what was typed) with `insert`, plus a space unless one follows. */
function applySuggestion(value: string, start: number, caret: number, insert: string): ComposerEdit {
  const tail = value.slice(caret);
  const space = /^\s/.test(tail) ? '' : ' ';
  const at = start + insert.length + space.length;
  return { value: value.slice(0, start) + insert + space + tail, start: at, end: at };
}

/** People whose login starts with `prefix`, then those that merely contain it; each login once; at most `limit`. */
function matchUsers(users: GithubUser[], prefix: string, limit = 8): GithubUser[] {
  const p = prefix.toLowerCase();
  const seen = new Set<string>();
  const unique = users.filter(u => !seen.has(u.login) && !!seen.add(u.login));
  const starts = unique.filter(u => u.login.toLowerCase().startsWith(p));
  const contains = unique.filter(u => !u.login.toLowerCase().startsWith(p) && u.login.toLowerCase().includes(p));
  return starts.concat(contains).slice(0, limit);
}

/** `> ` in front of every line of `text`, for Quote reply. Blank lines stay a bare `>`. */
function quoteMarkdown(text: string): string {
  return text.trim().split('\n').map(line => (line ? `> ${line}` : '>')).join('\n');
}

function userSuggestion(u: GithubUser): ComposerSuggestion {
  return { insert: `@${u.login}`, html: `${avatarHtml(u)} <b>${escapeHtml(u.login)}</b>` };
}

function issueSuggestion(i: { number: number; title: string; state: string }): ComposerSuggestion {
  return { insert: `#${i.number}`, html: `${issueStateIcon(i.state, null)} <b>#${i.number}</b> ${escapeHtml(i.title)}` };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, including 15 new `webviewComposer` tests; no failures elsewhere.

Run: `npm run compile`
Expected: no errors (this also refreshes `lib/issueDetail.js`).

- [ ] **Step 5: Commit**

```bash
git status --short
git add -A .
git commit -m "feat(null-tools): add pure text helpers for the Issues composer" -m "Toolbar edits, @/# trigger detection, suggestion matching and quoting, tested through the webview sandbox." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Host data layer (markdown preview, `#` suggestions, drafts, template `about`, create extras)

**Files:**
- Create: `src/github/issueDrafts.ts`, `src/github/issueDrafts.test.ts`
- Create: `src/github/issueSuggest.ts`, `src/github/issueSuggest.test.ts`
- Create: `src/github/createExtras.ts`, `src/github/createExtras.test.ts`
- Modify: `src/github/issueTemplates.ts`, `src/github/issueTemplates.test.ts`, `src/github/types.ts`, `src/github/githubApi.ts`, `src/github/issuesStore.ts`, `tsconfig.json` (`include`), `package.json` (`test` script)

**Interfaces:**
- Consumes: existing `request`, `failure`, `requestJson` in `githubApi.ts`; `IssuesStore.ensureSession`, `search`, `known`, `setIssueType`, `addSubIssue`, `getDetail`.
- Produces:
  - `draftKey(repo: GithubRepoRef, target: number | 'new'): string` → `null.issues.draft:<owner>/<repo>#<n|new>`
  - `IssueSuggestion { number; title; state: 'open' | 'closed' }`, `matchIssues(issues, prefix, limit = 8): IssueSuggestion[]`, `toSuggestion(i): IssueSuggestion`
  - `CreateExtraStep { what: string; run: () => Promise<unknown> }`, `runCreateExtras(steps): Promise<string[]>`
  - `renderMarkdown(text: string, repoFullName: string, token: string | null): Promise<string>` (githubApi)
  - `IssuesStore.renderPreview(text): Promise<string>`, `IssuesStore.suggestIssues(prefix): Promise<IssueSuggestion[]>`, `IssuesStore.applyCreateExtras(created, { typeId, parent }): Promise<string[]>`, and `createIssue` now also takes `milestone?: number`
  - `IssueTemplate.about: string`; `GithubIssue.node_id?: string`

- [ ] **Step 1: Write the failing tests**

Create `src/github/issueDrafts.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { draftKey } from './issueDrafts';

test('draftKey names the unsent text per repo and per issue, or the New issue form', () => {
  const repo = { owner: 'TorresVisual', repo: 'null-ide' };
  assert.strictEqual(draftKey(repo, 106), 'null.issues.draft:TorresVisual/null-ide#106');
  assert.strictEqual(draftKey(repo, 'new'), 'null.issues.draft:TorresVisual/null-ide#new');
  assert.notStrictEqual(draftKey(repo, 1), draftKey({ owner: 'TorresVisual', repo: 'other' }, 1));
});
```

Create `src/github/issueSuggest.test.ts`:

```ts
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
```

Create `src/github/createExtras.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { runCreateExtras } from './createExtras';

test('runCreateExtras reports a failing step by name and still runs the rest', async () => {
  const ran: string[] = [];
  const problems = await runCreateExtras([
    { what: 'set the type', run: async () => { throw new Error('forbidden'); } },
    { what: 'link it to #3', run: async () => { ran.push('parent'); } },
  ]);
  assert.deepStrictEqual(problems, ["couldn't set the type (forbidden)"]);
  assert.deepStrictEqual(ran, ['parent']);
});

test('runCreateExtras reports every failure, in order', async () => {
  const problems = await runCreateExtras([
    { what: 'set the type', run: async () => { throw new Error('a'); } },
    { what: 'link it to #3', run: async () => { throw new Error('b'); } },
  ]);
  assert.deepStrictEqual(problems, ["couldn't set the type (a)", "couldn't link it to #3 (b)"]);
});

test('runCreateExtras returns nothing when every step works, and for no steps', async () => {
  assert.deepStrictEqual(await runCreateExtras([{ what: 'x', run: async () => undefined }]), []);
  assert.deepStrictEqual(await runCreateExtras([]), []);
});
```

Replace the whole of `src/github/issueTemplates.test.ts` with (the template gains an `about` field, so the three expected objects change):

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { parseIssueTemplate } from './issueTemplates';

test('parseIssueTemplate reads name, about, title, and labels from frontmatter', () => {
  const raw = [
    '---',
    'name: Bug report',
    'about: Tell us what broke',
    "title: 'Bug: '",
    'labels: bug, needs-triage',
    '---',
    'Describe the bug here.',
  ].join('\n');
  assert.deepStrictEqual(parseIssueTemplate(raw, 'bug_report'), {
    name: 'Bug report',
    about: 'Tell us what broke',
    title: 'Bug: ',
    body: 'Describe the bug here.',
    labels: ['bug', 'needs-triage'],
  });
});

test('parseIssueTemplate falls back to filename and empty fields with no frontmatter', () => {
  assert.deepStrictEqual(parseIssueTemplate('Just a body.', 'blank'), {
    name: 'blank',
    about: '',
    title: '',
    body: 'Just a body.',
    labels: [],
  });
});

test('parseIssueTemplate defaults missing frontmatter fields', () => {
  const raw = ['---', 'about: no name or labels here', '---', 'Body text.'].join('\n');
  assert.deepStrictEqual(parseIssueTemplate(raw, 'feature_request'), {
    name: 'feature_request',
    about: 'no name or labels here',
    title: '',
    body: 'Body text.',
    labels: [],
  });
});
```

- [ ] **Step 2: Register the tests and run them to verify they fail**

In `tsconfig.json` `include`, add `"src/github/issueDrafts.test.ts", "src/github/issueSuggest.test.ts", "src/github/createExtras.test.ts"` after `"src/github/detailQueries.test.ts"`. In `package.json`'s `test` script append ` out/github/issueDrafts.test.js out/github/issueSuggest.test.js out/github/createExtras.test.js`.

Run: `npm test`
Expected: FAIL at `tsc` with `Cannot find module './issueDrafts'` (and the other two modules).

- [ ] **Step 3: Write the implementation**

Create `src/github/issueDrafts.ts`:

```ts
'use strict';

import { GithubRepoRef } from './types';

/** `workspaceState` key for the unsent text of one issue's comment box (`target` = the issue number) or of the New issue form (`'new'`). */
export function draftKey(repo: GithubRepoRef, target: number | 'new'): string {
  return `null.issues.draft:${repo.owner}/${repo.repo}#${target}`;
}
```

Create `src/github/issueSuggest.ts`:

```ts
'use strict';

import { GithubIssue } from './types';

export interface IssueSuggestion { number: number; title: string; state: 'open' | 'closed'; }
type Suggestible = Pick<GithubIssue, 'number' | 'title' | 'state'>;

export const toSuggestion = (i: Suggestible): IssueSuggestion => ({ number: i.number, title: i.title, state: i.state });

/**
 * Issues for the composer's `#` popup. A typed number matches issue numbers by prefix (`#12` finds 12, 120, 123) and
 * titles containing it; other text matches titles; nothing typed lists the newest. Each number once, newest first.
 */
export function matchIssues(issues: Suggestible[], prefix: string, limit = 8): IssueSuggestion[] {
  const byNumber = new Map<number, Suggestible>();
  for (const i of issues) byNumber.set(i.number, i);
  const p = prefix.toLowerCase();
  const numeric = /^\d+$/.test(p);
  return [...byNumber.values()]
    .filter(i => !p || (numeric && String(i.number).startsWith(p)) || i.title.toLowerCase().includes(p))
    .sort((a, b) => b.number - a.number)
    .slice(0, limit)
    .map(toSuggestion);
}
```

Create `src/github/createExtras.ts`:

```ts
'use strict';

export interface CreateExtraStep { what: string; run: () => Promise<unknown>; }

/**
 * Runs the steps that follow the REST create call (set the type, link the parent). A failing step never stops the
 * rest and never throws: it is reported by name, so a created issue is never lost to a half-applied form.
 */
export async function runCreateExtras(steps: CreateExtraStep[]): Promise<string[]> {
  const problems: string[] = [];
  for (const step of steps) {
    try {
      await step.run();
    } catch (err) {
      problems.push(`couldn't ${step.what} (${(err as Error).message})`);
    }
  }
  return problems;
}
```

In `src/github/types.ts`, add `about: string;` to `IssueTemplate` (after `name`) and add this field to `GithubIssue`, directly above `closedLocally?`:

```ts
  /** REST responses only (create/update). GraphQL-mapped issues don't carry it; the detail query has its own `id`. */
  node_id?: string;
```

In `src/github/issueTemplates.ts`, change the no-frontmatter return to `return { name: fallbackName, about: '', title: '', body: raw.trim(), labels: [] };` and the frontmatter return to:

```ts
  return {
    name: fields.name || fallbackName,
    about: fields.about || '',
    title: fields.title || '',
    body: body.trim(),
    labels: fields.labels ? fields.labels.split(',').map(l => l.trim()).filter(Boolean) : [],
  };
```

In `src/github/githubApi.ts`:

1. Add after `requestGraphql`:

```ts
/** POST /markdown (GFM, in this repo's context): GitHub's own HTML for `text`, as a posted comment would show it. Answers text/html, not JSON. */
export async function renderMarkdown(text: string, repoFullName: string, token: string | null): Promise<string> {
  const res = await request('/markdown', token, 'POST', { text, mode: 'gfm', context: repoFullName });
  if (res.status < 200 || res.status >= 300) throw failure(res);
  return res.body;
}
```

2. Change `createIssue`'s `data` type to `{ title: string; body?: string; labels?: string[]; assignees?: string[]; milestone?: number }`.

3. Delete `fetchRepoLabels` and `fetchAssignableUsers` (the form now uses `getMetadata()`), and drop `GithubLabel, GithubUser` from the `./types` import if nothing else in the file uses them.

In `src/github/issuesStore.ts`:

1. Imports: replace `import { IssuePatch, createIssue, fetchAssignableUsers, fetchRepoLabels, requestGraphql, updateIssue } from './githubApi';` with `import { IssuePatch, createIssue, renderMarkdown, requestGraphql, updateIssue } from './githubApi';`. Add:

```ts
import { CreateExtraStep, runCreateExtras } from './createExtras';
import { IssueSuggestion, matchIssues, toSuggestion } from './issueSuggest';
```

and drop `GithubLabel` and `GithubUser` from the `./types` import.

2. Delete the `repoLabels` and `assignableUsers` fields, their two `= null` lines in `setRepo`, and the methods `getRepoLabels` and `getAssignableUsers`.

3. Add these methods after `getTimelinePage`:

```ts
  /** GitHub's own rendering of `text` in this repo's context (so `#12` and `@user` become links), for the composer's Preview tab. */
  async renderPreview(text: string): Promise<string> {
    const { repo, token } = await this.ensureSession(false);
    return renderMarkdown(text, `${repo.owner}/${repo.repo}`, token);
  }

  /** Issues for the composer's `#` popup: what is already loaded first, then (from 2 characters) a server search. */
  async suggestIssues(prefix: string): Promise<IssueSuggestion[]> {
    const local = matchIssues([...this.known.values()], prefix);
    if (prefix.length < 2 || local.length >= 5) return local;
    try {
      const page = await this.search(prefix, null, false);
      const have = new Set(local.map(i => i.number));
      return local.concat(page.items.filter(i => !have.has(i.number)).map(toSuggestion)).slice(0, 8);
    } catch {
      return local; // offline or rate limited: the loaded issues are still a useful answer
    }
  }
```

4. Replace `createIssue` with:

```ts
  async createIssue(
    data: { title: string; body?: string; labels?: string[]; assignees?: string[]; milestone?: number },
  ): Promise<GithubIssue> {
    const { repo, token } = await this.ensureSession(true);
    const created = await createIssue(repo.owner, repo.repo, data, token);
    this.remember([created]);
    return created;
  }

  /**
   * REST create can't set an issue type or a parent, so they follow it. Returns what failed and never throws.
   * ponytail: the parent's node id comes from a full getDetail (100 timeline items); add a light id query if that is ever slow.
   */
  applyCreateExtras(created: GithubIssue, extras: { typeId: string | null; parent: number | null }): Promise<string[]> {
    const steps: CreateExtraStep[] = [];
    const { typeId, parent } = extras;
    if (typeId) {
      steps.push({
        what: 'set the type',
        run: async () => {
          if (!created.node_id) throw new Error('GitHub did not return the issue id');
          await this.setIssueType(created.node_id, typeId);
        },
      });
    }
    if (parent) {
      steps.push({
        what: `link it to #${parent}`,
        run: async () => this.addSubIssue((await this.getDetail(parent)).id, created.number),
      });
    }
    return runCreateExtras(steps);
  }
```

- [ ] **Step 4: Run the tests and make sure nothing referenced the deleted helpers**

Run: `grep -rn "getRepoLabels\|getAssignableUsers\|fetchRepoLabels\|fetchAssignableUsers" src`
Expected: the only remaining hits are the two calls in `src/issueDetailPanel.ts` `_sendCreateForm` (Task 6 rewrites that method). To keep `tsc` green until then, replace `this.store.getRepoLabels().catch((): GithubLabel[] => [])` with `Promise.resolve([] as GithubLabel[])` and `this.store.getAssignableUsers().catch((): GithubUser[] => [])` with `Promise.resolve([] as GithubUser[])`.

Run: `npm test`
Expected: PASS, including `draftKey`, 4 `matchIssues`, 3 `runCreateExtras` and the updated `parseIssueTemplate` tests.

- [ ] **Step 5: Commit**

```bash
git status --short
git add -A .
git commit -m "feat(null-tools): add markdown preview, # suggestions and draft keys to the Issues store" -m "Also reads the template 'about' line, and applies issue type and parent after a REST create without losing the issue if either fails." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Composer component (`composer.ts`), toolbar icons, styles

**Files:**
- Create: `src/webview/composer.ts`
- Modify: `scripts/gen-octicons.js`, `src/webview/shared/octicons.ts` (regenerated), `tsconfig.webview-issue-detail.json` (`include`), `lib/issueDetail.css`

**Interfaces:**
- Consumes: Task 1's `COMPOSER_TOOLS`, `applyTool`, `activeTrigger`, `applySuggestion`, `matchUsers`, `userSuggestion`, `issueSuggestion`, `ComposerEdit`, `ComposerSuggestion`; existing `octicon`, `escapeHtml`, `neutralizeImagesHtml`, `GithubUser`; `DOMPurify` (declared in `issueDetail.ts`).
- Produces (webview globals):
  - `interface ComposerOptions { value; pristine?; label; placeholder; post(message); users(): GithubUser[]; onChange?(value); onSubmit?(); onCancel?() }`
  - `interface Composer { el: HTMLElement; getValue(): string; setValue(value: string): void; insertBlock(block: string): void; focus(): void }`
  - `createComposer(opts: ComposerOptions): Composer`
  - `composerReceive(msg: { requestId?: number }): void`: the entry script calls it for every `previewResult` and `suggestions` message.
  - Messages it sends: `{ type: 'preview', requestId, text }`, `{ type: 'suggest', requestId, prefix }`. Messages it consumes (via `composerReceive`): `{ requestId, html } | { requestId, error }` and `{ requestId, items: Array<{ number, title, state }> }`.

This task has no unit test: the component is DOM-only and every text change it applies is tested in Task 1. It is exercised for real in Task 4 and checked in Task 8.

- [ ] **Step 1: Add the toolbar octicons**

In `scripts/gen-octicons.js`, add one line to `NAMES` before the closing `];`:

```js
  'heading', 'bold', 'italic', 'code', 'list-unordered', 'list-ordered', 'tasklist',
```

Run (bash, from `extensions/null-tools/`):

```bash
TMP=$(mktemp -d)
mkdir -p "$TMP/octicons" && (cd "$TMP/octicons" && npm pack @primer/octicons@19.38.0 --silent && tar xzf primer-octicons-19.38.0.tgz)
node scripts/gen-octicons.js "$TMP/octicons/package"
git diff --stat src/webview/shared/octicons.ts
```

Expected: `wrote 40 octicons from @primer/octicons 19.38.0 …`, and the diff shows only added lines.

- [ ] **Step 2: Write the component**

In `tsconfig.webview-issue-detail.json`, add `"src/webview/composer.ts",` on the line before `"src/webview/issueCreate.ts", "src/webview/issueDetail.ts"`.

Create `src/webview/composer.ts`:

```ts
'use strict';

// The Write / Preview editor behind new comments, comment and description edits, and the New issue form.
// DOM only, so it has no unit tests; every text change it applies comes from composerText.ts, which does.

interface ComposerOptions {
  /** Initial text. */
  value: string;
  /** What Esc compares against to decide whether there is anything to discard. Default: `value`. */
  pristine?: string;
  label: string;
  placeholder: string;
  post(message: unknown): void;
  /** People `@` can mention. Read on every keystroke, so it may change while the composer is open. */
  users(): GithubUser[];
  onChange?(value: string): void;
  /** Ctrl/Cmd+Enter. */
  onSubmit?(): void;
  /** Esc. With unsent changes the first Esc only asks to press it again. */
  onCancel?(): void;
}

interface Composer {
  el: HTMLElement;
  getValue(): string;
  setValue(value: string): void;
  /** Appends a block (a quote) after the current text, switches to Write and focuses. */
  insertBlock(block: string): void;
  focus(): void;
}

/** Host answers the composers are still waiting for (preview, `#` suggestions), by request id. */
const composerWaiting = new Map<number, (msg: any) => void>();
let composerSeq = 0;

/** Routes the host's `previewResult` / `suggestions` to whichever composer asked. Unknown or already-answered ids are ignored. */
function composerReceive(msg: { requestId?: number }): void {
  const waiting = msg.requestId === undefined ? undefined : composerWaiting.get(msg.requestId);
  if (!waiting) return;
  composerWaiting.delete(msg.requestId!);
  waiting(msg);
}

const COMPOSER_MIRRORED = [
  'box-sizing', 'width', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'tab-size',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
];

/** Where the caret at `index` is inside `ta`, measured by laying the same text out in a hidden copy of it. */
function composerCaretOffset(ta: HTMLTextAreaElement, index: number): { left: number; top: number; height: number } {
  const style = getComputedStyle(ta);
  const mirror = document.createElement('div');
  for (const prop of COMPOSER_MIRRORED) mirror.style.setProperty(prop, style.getPropertyValue(prop));
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.textContent = ta.value.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const at = { left: marker.offsetLeft - ta.scrollLeft, top: marker.offsetTop - ta.scrollTop, height: marker.offsetHeight };
  mirror.remove();
  return at;
}

function createComposer(opts: ComposerOptions): Composer {
  const el = document.createElement('div');
  el.className = 'composer';
  el.innerHTML = `
    <div class="composer-head">
      <div class="composer-tabs" role="tablist">
        <button type="button" class="composer-tab active" role="tab" aria-selected="true" data-tab="write">Write</button>
        <button type="button" class="composer-tab" role="tab" aria-selected="false" data-tab="preview">Preview</button>
      </div>
      <div class="composer-tools">${COMPOSER_TOOLS.map(t =>
        `<button type="button" class="icon-btn" data-tool="${t.id}" title="${t.title}" aria-label="${t.title}">${octicon(t.icon)}</button>`).join('')}</div>
    </div>
    <textarea class="composer-input" spellcheck="true"></textarea>
    <div class="composer-preview post-body hidden"></div>
    <div class="composer-hint hidden" role="status"></div>
    <div class="composer-suggest hidden" role="listbox"></div>`;
  const ta = el.querySelector('.composer-input') as HTMLTextAreaElement;
  const preview = el.querySelector('.composer-preview') as HTMLElement;
  const hint = el.querySelector('.composer-hint') as HTMLElement;
  const popup = el.querySelector('.composer-suggest') as HTMLElement;
  const tools = el.querySelector('.composer-tools') as HTMLElement;
  ta.value = opts.value;
  ta.placeholder = opts.placeholder;
  ta.setAttribute('aria-label', opts.label);

  let mode: 'write' | 'preview' = 'write';
  let previewedText: string | null = null;
  let previewSeq = 0;
  let armedDiscard = false;
  let suggestions: ComposerSuggestion[] = [];
  let active = 0;
  let trigger: { trigger: '@' | '#'; prefix: string; start: number } | null = null;
  let suggestSeq = 0;
  let suggestTimer: ReturnType<typeof setTimeout> | undefined;

  const changed = (): void => {
    armedDiscard = false;
    hint.classList.add('hidden');
    opts.onChange?.(ta.value);
  };

  // ---- text edits ---------------------------------------------------------------------------------------------

  /** Replaces the whole text through the browser's edit command so Ctrl+Z still works; plain assignment would wipe the undo stack. */
  function replaceAll(edit: ComposerEdit): void {
    const scroll = ta.scrollTop;
    ta.focus();
    ta.select();
    if (!edit.value || !document.execCommand('insertText', false, edit.value)) ta.value = edit.value;
    ta.setSelectionRange(edit.start, edit.end);
    ta.scrollTop = scroll;
    closeSuggest(); // the input event the edit command fires may have opened the popup for the old caret
    changed();
  }

  function runTool(id: string): void {
    if (mode !== 'write') return;
    const edit = applyTool(id, ta.value, ta.selectionStart, ta.selectionEnd);
    if (edit) replaceAll(edit);
  }

  // ---- Write / Preview ----------------------------------------------------------------------------------------

  function showPreview(): void {
    const text = ta.value;
    previewedText = null;
    if (!text.trim()) {
      preview.innerHTML = '<span class="muted">Nothing to preview</span>';
      return;
    }
    preview.innerHTML = '<span class="muted">Loading preview…</span>';
    const id = ++composerSeq;
    previewSeq = id;
    composerWaiting.set(id, msg => {
      // The user may have gone back to Write, or asked for a newer preview, while this was in flight.
      if (mode !== 'preview' || previewSeq !== id) return;
      if (msg.error) {
        preview.innerHTML = `<span class="field-error">${escapeHtml(msg.error)}</span>`;
        return;
      }
      preview.innerHTML = DOMPurify.sanitize(neutralizeImagesHtml(msg.html));
      previewedText = text;
    });
    opts.post({ type: 'preview', requestId: id, text });
  }

  function setMode(next: 'write' | 'preview'): void {
    mode = next;
    closeSuggest();
    el.querySelectorAll<HTMLElement>('.composer-tab').forEach(tab => {
      const on = tab.dataset.tab === next;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', String(on));
    });
    ta.classList.toggle('hidden', next === 'preview');
    tools.classList.toggle('hidden', next === 'preview');
    preview.classList.toggle('hidden', next === 'write');
    if (next === 'write') ta.focus();
    else if (previewedText !== ta.value) showPreview();
  }

  // ---- @ and # autocomplete -----------------------------------------------------------------------------------

  function closeSuggest(): void {
    clearTimeout(suggestTimer);
    suggestSeq++; // any answer still on its way is now stale
    suggestions = [];
    trigger = null;
    popup.classList.add('hidden');
  }

  function renderSuggest(): void {
    if (suggestions.length === 0) {
      popup.classList.add('hidden');
      return;
    }
    popup.innerHTML = suggestions.map((s, i) =>
      `<button type="button" class="composer-suggest-item${i === active ? ' active' : ''}" role="option" data-index="${i}">${s.html}</button>`).join('');
    popup.classList.remove('hidden');
    const at = composerCaretOffset(ta, ta.selectionStart);
    popup.style.left = `${Math.max(0, Math.min(ta.offsetLeft + at.left, el.clientWidth - popup.offsetWidth - 4))}px`;
    popup.style.top = `${ta.offsetTop + at.top + at.height + 2}px`;
  }

  function updateSuggest(): void {
    const t = ta.selectionStart === ta.selectionEnd ? activeTrigger(ta.value, ta.selectionStart) : null;
    if (!t) {
      closeSuggest();
      return;
    }
    trigger = t;
    clearTimeout(suggestTimer);
    const id = ++suggestSeq;
    if (t.trigger === '@') {
      suggestions = matchUsers(opts.users(), t.prefix).map(userSuggestion);
      active = 0;
      renderSuggest();
      return;
    }
    suggestTimer = setTimeout(() => {
      const request = ++composerSeq;
      composerWaiting.set(request, msg => {
        if (id !== suggestSeq || !trigger) return; // typed on, moved the caret, or closed the popup
        suggestions = (msg.items as Array<{ number: number; title: string; state: string }>).map(issueSuggestion);
        active = 0;
        renderSuggest();
      });
      opts.post({ type: 'suggest', requestId: request, prefix: t.prefix });
    }, 150);
  }

  function accept(index: number): void {
    const s = suggestions[index];
    if (!s || !trigger) return;
    replaceAll(applySuggestion(ta.value, trigger.start, ta.selectionStart, s.insert));
  }

  // ---- events -------------------------------------------------------------------------------------------------

  ta.addEventListener('input', () => {
    changed();
    updateSuggest();
  });
  ta.addEventListener('click', updateSuggest);
  ta.addEventListener('blur', closeSuggest);

  ta.addEventListener('keydown', e => {
    if (e.isComposing) return; // an input method is still choosing characters
    const open = !popup.classList.contains('hidden');
    const mod = e.ctrlKey || e.metaKey;
    if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length;
      renderSuggest();
      return;
    }
    if (open && (e.key === 'Enter' || e.key === 'Tab') && !mod) {
      e.preventDefault();
      accept(active);
      return;
    }
    if (open && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeSuggest();
      return;
    }
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      opts.onSubmit?.();
      return;
    }
    if (mod && !e.altKey && !e.shiftKey) {
      const tool = COMPOSER_TOOLS.find(t => t.key === e.key.toLowerCase());
      if (tool) {
        e.preventDefault();
        runTool(tool.id);
        return;
      }
    }
    if (e.key === 'Escape' && opts.onCancel) {
      e.preventDefault();
      if (ta.value !== (opts.pristine ?? opts.value) && !armedDiscard) {
        armedDiscard = true;
        hint.textContent = 'Press Esc again to discard your changes.';
        hint.classList.remove('hidden');
      } else {
        opts.onCancel();
      }
    }
  });

  el.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const tab = target.closest<HTMLElement>('[data-tab]');
    if (tab) {
      setMode(tab.dataset.tab as 'write' | 'preview');
      return;
    }
    const tool = target.closest<HTMLElement>('[data-tool]');
    if (tool) runTool(tool.dataset.tool!);
  });

  // mousedown, not click, and preventDefault: the textarea keeps focus, so the blur handler doesn't close the popup first.
  popup.addEventListener('mousedown', e => {
    e.preventDefault();
    const item = (e.target as HTMLElement).closest<HTMLElement>('.composer-suggest-item');
    if (item) accept(Number(item.dataset.index));
  });

  return {
    el,
    getValue: () => ta.value,
    setValue(value) {
      if (mode === 'preview') setMode('write');
      replaceAll({ value, start: value.length, end: value.length });
    },
    insertBlock(block) {
      if (mode === 'preview') setMode('write');
      const base = ta.value.replace(/\s+$/, '');
      const value = `${base ? `${base}\n\n` : ''}${block}\n\n`;
      replaceAll({ value, start: value.length, end: value.length });
      ta.scrollTop = ta.scrollHeight;
    },
    focus() {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    },
  };
}
```

- [ ] **Step 3: Style it**

In `lib/issueDetail.css`, insert this block directly above the `/* ---- toast ---- */` comment:

```css
/* ---- composer (Write / Preview editor) ---- */
.composer { position:relative; }
.composer-head { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; margin-bottom:6px; }
.composer-tabs { display:flex; gap:2px; }
.composer-tab {
  padding:3px 10px; border:1px solid transparent; border-radius:4px; background:transparent;
  color:var(--vscode-descriptionForeground); cursor:pointer;
}
.composer-tab:hover { color:var(--vscode-foreground); }
.composer-tab.active {
  color:var(--vscode-foreground); background:var(--vscode-editor-background);
  border-color:var(--vscode-widget-border,rgba(128,128,128,.4));
}
.composer-tools { display:flex; gap:2px; }
.composer-input {
  display:block; width:100%; box-sizing:border-box; min-height:110px; resize:vertical; padding:8px; font:inherit; border-radius:4px;
  background:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border,transparent);
}
.composer-input:focus { outline:none; border-color:var(--vscode-focusBorder); }
.composer-preview { min-height:110px; padding:8px; border-radius:4px; border:1px solid var(--vscode-widget-border,rgba(128,128,128,.3)); }
.composer-hint { margin-top:4px; color:var(--vscode-descriptionForeground); font-size:.9em; }
.composer-suggest {
  position:absolute; z-index:20; min-width:220px; max-width:360px; max-height:220px; overflow-y:auto; padding:4px;
  background:var(--vscode-editorSuggestWidget-background,var(--vscode-editorWidget-background));
  border:1px solid var(--vscode-editorSuggestWidget-border,var(--vscode-widget-border,rgba(128,128,128,.4)));
  border-radius:6px; box-shadow:0 6px 18px rgba(0,0,0,.35);
}
.composer-suggest-item {
  display:flex; align-items:center; gap:6px; width:100%; padding:4px 8px; border:none; border-radius:4px;
  background:transparent; color:var(--vscode-foreground); text-align:left; cursor:pointer;
}
.composer-suggest-item.active, .composer-suggest-item:hover { background:var(--vscode-list-hoverBackground); }

```

- [ ] **Step 4: Compile and test**

Run: `npm run compile && npm test`
Expected: no TypeScript errors; all tests still pass. (`composer.ts` is only in the `issueDetail.js` bundle, so `out/webview-shared.js` is unchanged.)

- [ ] **Step 5: Commit**

```bash
git status --short
git add -A .
git commit -m "feat(null-tools): add the Write/Preview composer component for Issues" -m "Toolbar, shortcuts, GitHub-rendered preview, @/# autocomplete with stale-reply guards and a double-Esc discard hint. Not wired in yet." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Composer in the detail tab (comments, edits, drafts, quote reply)

**Files:**
- Modify: `src/webview/detailHtml.ts` (edit-mode markup), `src/webviewDetail.test.ts` (one test), `src/webview/issueDetail.ts`, `src/issueDetailPanel.ts`, `src/issuesPanelIntegration.ts`

**Interfaces:**
- Consumes: Task 2's `draftKey`, `IssuesStore.renderPreview`, `IssuesStore.suggestIssues`; Task 3's `createComposer`, `composerReceive`; Task 1's `quoteMarkdown`.
- Produces:
  - `postHtml(post, kind, editing)` in edit mode now emits `<div class="post-edit"><div class="composer-slot" data-id="…"></div><div class="btn-row">…save-edit / cancel-edit…</div></div>`. The markdown source is **never** put in the markup; `issueDetail.ts` fills the slot with a composer.
  - Host messages in: `{ type: 'preview'; requestId: number; text: string }`, `{ type: 'suggest'; requestId: number; prefix: string }`, `{ type: 'saveDraft'; number: number; body: string }`. Out: `{ type: 'previewResult'; requestId; html } | { …; error }`, `{ type: 'suggestions'; requestId; items: IssueSuggestion[] }`, and `draft: string` added to the `detail` message.
  - `IssueDetailPanel.configure(drafts: vscode.Memento): void` (Task 6 widens it).

- [ ] **Step 1: Update the test that pins the old edit markup**

In `src/webviewDetail.test.ts`, replace the test `postHtml in edit mode shows the escaped markdown source instead of the rendered body` with:

```ts
test('postHtml in edit mode leaves a slot for the composer and never inlines the markdown source', () => {
  const out = html.postHtml(post({ body: 'a </textarea><script>x</script>' }), 'comment', true);
  assert.ok(out.includes('class="composer-slot" data-id="IC_1"'));
  assert.ok(!out.includes('post-body'));
  assert.ok(!out.includes('<script>'));
  assert.ok(!out.includes('</textarea>'));
  assert.ok(!out.includes('a &lt;/textarea&gt;'), 'the source is set as a value by the composer, not written into markup');
  assert.ok(out.includes('data-act="save-edit"'));
  assert.ok(out.includes('data-act="cancel-edit"'));
});
```

Run: `npm test`
Expected: FAIL, this test (`the composer-slot` assertion), everything else passing.

- [ ] **Step 2: Emit the slot in `detailHtml.ts`**

In `src/webview/detailHtml.ts`, update the doc comment of `postHtml` (`…swaps the rendered body for a plain textarea (the Phase 4 composer replaces it).` → `…swaps the rendered body for an empty slot that issueDetail.ts fills with a composer.`) and replace the `content` constant's editing branch:

```ts
  const content = editing
    ? `<div class="post-edit">
         <div class="composer-slot" data-id="${id}"></div>
         <div class="btn-row">
           <button type="button" class="btn btn-primary" data-act="save-edit" data-id="${id}">Update ${kind === 'body' ? 'description' : 'comment'}</button>
           <button type="button" class="btn btn-secondary" data-act="cancel-edit">Cancel</button>
         </div>
       </div>`
    : `<div class="post-body">${post.bodyHTML || '<span class="muted">No description provided.</span>'}</div>${reactionsHtml(post)}`;
```

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Host side: drafts, preview, suggestions**

In `src/issueDetailPanel.ts`:

1. Add to the imports: `import { draftKey } from './github/issueDrafts';`

2. Add to `InboundMessage` (before `submitCreate`):

```ts
  | { type: 'preview'; requestId: number; text: string }
  | { type: 'suggest'; requestId: number; prefix: string }
  | { type: 'saveDraft'; number: number; body: string }
```

3. Add inside the class, directly under `private static creatingTab: IssueDetailPanel | undefined;`:

```ts
  /** Where unsent comment text is kept; set once by registerIssuesPanelFeature. */
  private static drafts: vscode.Memento | undefined;

  static configure(drafts: vscode.Memento): void {
    IssueDetailPanel.drafts = drafts;
  }
```

4. Add these private methods after `_cwd()`:

```ts
  /** `number` 0 is the New issue form. */
  private _draftKey(number: number): string | null {
    const repo = this.store.getRepo();
    return repo ? draftKey(repo, number || 'new') : null;
  }

  private _readDraft(number: number): string {
    const key = this._draftKey(number);
    return key && IssueDetailPanel.drafts ? IssueDetailPanel.drafts.get<string>(key, '') : '';
  }

  /** Empty or whitespace-only text deletes the draft. */
  private _writeDraft(number: number, body: string): void {
    const key = this._draftKey(number);
    if (key && IssueDetailPanel.drafts) void IssueDetailPanel.drafts.update(key, body.trim() ? body : undefined);
  }
```

5. In `_load`, add `draft: this._readDraft(number),` to the `detail` message (after `afterWrite,`).

6. In the `postComment` case, after the successful `this._post({ type: 'commentAdded', item });` add `this._writeDraft(number, '');` (still inside the `try`, so a failed post keeps the draft).

7. Add these cases to `_handleMessage`'s `switch`, before `case 'openIssue':`:

```ts
      case 'preview':
        try {
          this._post({ type: 'previewResult', requestId: msg.requestId, html: await this.store.renderPreview(msg.text) });
        } catch (err) {
          this._post({ type: 'previewResult', requestId: msg.requestId, error: (err as Error).message });
        }
        break;
      case 'suggest':
        this._post({ type: 'suggestions', requestId: msg.requestId, items: await this.store.suggestIssues(msg.prefix).catch(() => []) });
        break;
      case 'saveDraft':
        this._writeDraft(msg.number, msg.body);
        break;
```

In `src/issuesPanelIntegration.ts`, add `import { IssueDetailPanel } from './issueDetailPanel';` and, directly after `const provider = new IssuesViewProvider(…);`:

```ts
  IssueDetailPanel.configure(context.workspaceState);
```

- [ ] **Step 4: Webview side: mount composers in `issueDetail.ts`**

Make these edits in `src/webview/issueDetail.ts` (each `find` is exact text from the current file):

**4a. State.** After `let editingId: string | null = null;` add:

```ts
  /** What the open edit form holds. The timeline is rebuilt around the form on every render, so the form is re-created from this. */
  let editDraft = '';
  let editComposer: Composer | null = null;
  let commentComposer: Composer | null = null;
  /** Unsent new-comment text queued for the host, and the timer that sends it. */
  let pendingDraft: { number: number; body: string } | null = null;
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
```

**4b. Helpers.** Add directly after the `plural` helper (`const plural = …`):

```ts
  const mentionUsers = (): GithubUser[] => [...(metadata?.assignees ?? []), ...(detail?.participants ?? [])];

  /** The unsent comment text is stored by the host 500 ms after the last keystroke, so it survives switching issues and closing the tab. */
  function saveDraftSoon(number: number, body: string): void {
    pendingDraft = { number, body };
    clearTimeout(draftTimer);
    draftTimer = setTimeout(flushDraft, 500);
  }

  /** Sends a queued draft now. It carries the issue number it was typed for, so a late flush can't land under another issue. */
  function flushDraft(): void {
    clearTimeout(draftTimer);
    if (pendingDraft) post({ type: 'saveDraft', ...pendingDraft });
    pendingDraft = null;
  }

  function dropDraft(): void {
    clearTimeout(draftTimer);
    pendingDraft = null;
  }
  document.addEventListener('visibilitychange', flushDraft);

  function startEditing(target: IssuePost): void {
    editingId = target.id;
    editDraft = target.body;
    renderTimeline();
    editComposer?.focus();
  }

  function stopEditing(): void {
    editingId = null;
    editDraft = '';
    editComposer = null;
  }
```

**4c. `renderTimeline`.** Replace the whole function with:

```ts
  function renderTimeline(): void {
    if (!detail) return;
    const d = detail;
    // The timeline is rebuilt below; if the user was typing in the edit form, put the caret back afterwards.
    const refocus = editComposer !== null && editComposer.el.contains(document.activeElement);
    const parts = [postHtml(prepared(d.post), 'body', editingId === d.post.id), subIssuesHtml(d)];
    for (const item of d.timeline) {
      parts.push(item.kind === 'comment' ? postHtml(prepared(item), 'comment', editingId === item.id) : eventHtml(item));
    }
    if (hasMoreTimeline) parts.push('<button type="button" class="btn btn-ghost load-more" data-act="load-more">Load more</button>');
    $('timeline').innerHTML = parts.join('');
    mountEditComposer();
    if (refocus) editComposer?.focus();
    // GitHub's rendered task items are disabled checkboxes; make them live for people who can edit the body.
    $('timeline').querySelectorAll<HTMLInputElement>('.post[data-kind="body"] .post-body input[type=checkbox]')
      .forEach((box, index) => {
        box.disabled = !d.post.viewerCanUpdate;
        box.addEventListener('change', () => {
          beginWrite(() => undefined);
          post({ type: 'toggleTask', index, checked: box.checked });
        });
      });
    bindAvatarFallbacks();
  }

  /** Puts a composer in the open edit form's slot. It is re-created on every render, from `editDraft`. */
  function mountEditComposer(): void {
    editComposer = null;
    const slot = root.querySelector<HTMLElement>('.composer-slot');
    if (!slot || editingId === null || !detail) return;
    const id = editingId;
    editComposer = createComposer({
      value: editDraft,
      pristine: findPost(id)?.body ?? '',
      label: id === detail.post.id ? 'Edit description' : 'Edit comment',
      placeholder: '',
      post,
      users: mentionUsers,
      onChange: v => { editDraft = v; },
      onSubmit: () => saveEdit(id),
      onCancel: () => { stopEditing(); renderTimeline(); },
    });
    slot.replaceWith(editComposer.el);
  }
```

**4d. `mountComposer` and `updateComposer`.** Replace both functions with:

```ts
  function mountComposer(draft: string): void {
    $('composer').innerHTML = `
      <div class="composer-card">
        <div id="comment-slot"></div>
        <div class="composer-actions">
          <span class="split">
            <button type="button" class="btn btn-ghost" id="close-main" data-act="close-main"></button>
            <button type="button" class="btn btn-ghost split-caret" id="close-caret" data-act="close-menu" aria-label="Close options">${octicon('triangle-down')}</button>
          </span>
          <button type="button" class="btn btn-primary" id="comment-btn" data-act="comment">Comment</button>
        </div>
      </div>`;
    commentComposer = createComposer({
      value: draft,
      label: 'Comment',
      placeholder: 'Leave a comment',
      post,
      users: mentionUsers,
      onChange: v => { updateComposer(); saveDraftSoon(composerFor, v); },
      onSubmit: () => submitComment(),
    });
    $('comment-slot').replaceWith(commentComposer.el);
    commentBusy = false;
  }

  /** Close/Reopen wording follows the issue's state and whether a comment is typed, like github.com. */
  function updateComposer(): void {
    if (!commentComposer || !detail) return;
    const hasText = commentComposer.getValue().trim().length > 0;
    const closed = detail.issue.state === 'closed';
    $('close-main').textContent = closed ? (hasText ? 'Reopen with comment' : 'Reopen issue') : (hasText ? 'Close with comment' : 'Close issue');
    $('close-caret').classList.toggle('hidden', closed);
    $<HTMLButtonElement>('close-main').disabled = commentBusy;
    $<HTMLButtonElement>('close-caret').disabled = commentBusy;
    $<HTMLButtonElement>('comment-btn').disabled = commentBusy || !hasText;
  }
```

**4e. `submitComment`.** Replace its first two lines (`const input = $<HTMLTextAreaElement>('comment-input');` / `const body = input.value.trim();`) with `const body = commentComposer ? commentComposer.getValue().trim() : '';`. The rest of the function is unchanged.

**4f. Edit saving.** Add this function after `submitComment`:

```ts
  function saveEdit(id: string): void {
    if (!editComposer || root.querySelector<HTMLButtonElement>('[data-act="save-edit"]')?.disabled) return;
    const body = editComposer.getValue();
    const isBody = detail?.post.id === id;
    if (!isBody && !body.trim()) {
      toast('A comment can\'t be empty.');
      return;
    }
    if (isBody) beginWrite(() => undefined); // re-renders the form, so the button is looked up afterwards
    const button = root.querySelector<HTMLButtonElement>('[data-act="save-edit"]');
    if (button) {
      button.disabled = true;
      button.textContent = 'Saving…';
    }
    post({ type: 'editPost', kind: isBody ? 'body' : 'comment', id, body });
  }
```

and in `handleAction` replace the whole `case 'save-edit': { … }` block with `case 'save-edit': saveEdit(id); break;`, and replace `case 'cancel-edit': editingId = null; renderTimeline(); break;` with `case 'cancel-edit': stopEditing(); renderTimeline(); break;`.

**4g. Quote reply and the Edit menu item.** Replace `quoteReply` with:

```ts
  function quoteReply(target: IssuePost): void {
    const postEl = root.querySelector(`.post[data-id="${CSS.escape(target.id)}"]`);
    const selection = window.getSelection();
    const selected = selection && postEl && postEl.contains(selection.anchorNode) ? selection.toString().trim() : '';
    commentComposer?.insertBlock(quoteMarkdown(selected || target.body));
  }
```

and in `postMenu` replace `else if (action === 'edit') { editingId = target.id; renderTimeline(); root.querySelector<HTMLTextAreaElement>('.post-edit-input')?.focus(); }` with `else if (action === 'edit') startEditing(target);`.

**4h. Message handler.**

- In `case 'detail'`, replace the block

```ts
        if (composerFor !== msg.detail.issue.number) {
          composerFor = msg.detail.issue.number;
          editingId = null;
          editingTitle = false;
          mountComposer();
        }
        if (msg.afterWrite) { editingId = null; editingTitle = false; }
```

with

```ts
        if (composerFor !== msg.detail.issue.number) {
          flushDraft(); // whatever was typed for the previous issue belongs to it
          composerFor = msg.detail.issue.number;
          stopEditing();
          editingTitle = false;
          mountComposer(msg.draft ?? '');
        }
        if (msg.afterWrite) { stopEditing(); editingTitle = false; }
```

- In `case 'commentAdded'`, replace `$<HTMLTextAreaElement>('comment-input').value = '';` with `commentComposer?.setValue('');`.
- In `case 'postUpdated'`, replace `editingId = null;` with `stopEditing();`.
- In `case 'failed'`, inside the rollback block replace `editingId = null;` with `stopEditing();`.
- Add before `case 'candidates':`:

```ts
      case 'previewResult':
      case 'suggestions':
        composerReceive(msg);
        break;
```

- [ ] **Step 5: Verify nothing still touches the old textareas, then build and test**

Run: `grep -n "comment-input\|post-edit-input\|editingId = " src/webview/issueDetail.ts`
Expected: no `comment-input`/`post-edit-input` hits; the only `editingId = ` hits are in `startEditing` and `stopEditing`.

Run: `npm run compile && npm test`
Expected: no TypeScript errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git status --short
git add -A .
git commit -m "feat(null-tools): use the composer for Issues comments, edits and drafts" -m "Write/Preview and autocomplete in the new-comment box and in post edits; unsent comment text is kept per issue in workspaceState; Quote reply goes through the composer." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Create-form HTML builders (`createFormHtml.ts`)

**Files:**
- Create: `src/webview/createFormHtml.ts`, `src/webviewCreate.test.ts`
- Modify: `src/webview/detailTypes.ts` (`IssueTemplate.about`), `tsconfig.webview-shared.json`, `tsconfig.webview-issue-detail.json`, `tsconfig.json`, `package.json`

**Interfaces:**
- Consumes (existing webview globals): `escapeHtml`, `avatarHtml`, `eventLabelChips`, `octicon`, `sidebarSection(key, title, canEdit, body)`, `IssueTemplate`, `DetailMetadata`, `GithubUser`, `GithubLabel`.
- Produces (webview globals, pure):
  - `interface CreateSidebarState { assignees: GithubUser[]; labels: GithubLabel[]; type: { id: string; name: string } | null; milestone: { number: number; title: string } | null; parent: { number: number; title: string } | null }`
  - `templateChooserHtml(templates: IssueTemplate[]): string`: one `button.template-card[data-act="pick-template"][data-index]` per template, then the Blank card with `data-index="-1"`.
  - `createSidebarHtml(state: CreateSidebarState, meta: DetailMetadata | null): string`: `.sb-section`s with `data-act="pick-assignees|pick-labels|pick-type|pick-milestone|pick-parent"`; Type only when `meta.types.length > 0`.

- [ ] **Step 1: Write the failing test**

Create `src/webviewCreate.test.ts`:

```ts
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
```

- [ ] **Step 2: Register the test and run it to verify it fails**

`tsconfig.json` `include`: add `"src/webviewCreate.test.ts"`. `package.json` `test` script: append ` out/webviewCreate.test.js`.
`tsconfig.webview-shared.json` `include`: add `"src/webview/createFormHtml.ts"` after `"src/webview/composerText.ts"`. `tsconfig.webview-issue-detail.json` `include`: add `"src/webview/createFormHtml.ts",` right after `"src/webview/composerText.ts",`. Create the file as `printf "'use strict';\n" > src/webview/createFormHtml.ts`.

Run: `npm test`
Expected: FAIL, `html.templateChooserHtml is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/webview/detailTypes.ts` change `interface IssueTemplate { name: string; title: string; body: string; labels: string[]; }` to:

```ts
interface IssueTemplate { name: string; about: string; title: string; body: string; labels: string[]; }
```

Replace `src/webview/createFormHtml.ts` with:

```ts
'use strict';

// Pure HTML for the New issue form: the template chooser and the right sidebar (see detailHtml.ts for the conventions).

/** What the form's sidebar shows. The form keeps one of these and re-renders the sidebar whenever a picker changes it. */
interface CreateSidebarState {
  assignees: GithubUser[];
  labels: GithubLabel[];
  type: { id: string; name: string } | null;
  milestone: { number: number; title: string } | null;
  parent: { number: number; title: string } | null;
}

/** One card per template, then a Blank issue card. `data-index` is the template's position, -1 for Blank. */
function templateChooserHtml(templates: IssueTemplate[]): string {
  const card = (index: number, name: string, about: string): string => `
    <button type="button" class="template-card" data-act="pick-template" data-index="${index}">
      <b>${escapeHtml(name)}</b>${about ? `<span class="muted">${escapeHtml(about)}</span>` : ''}
    </button>`;
  return `<h1 class="title">Choose a template</h1>
    <div class="template-grid">${templates.map((t, i) => card(i, t.name, t.about)).join('')}${card(-1, 'Blank issue', 'Create a new issue from scratch')}</div>`;
}

/** Assignees, Labels, Type (only for repos that have issue types), Milestone and Parent, each with an edit gear. */
function createSidebarHtml(s: CreateSidebarState, meta: DetailMetadata | null): string {
  const none = (text: string): string => `<span class="muted">${text}</span>`;
  const assignees = s.assignees.length > 0
    ? s.assignees.map(a => `<div class="sb-person">${avatarHtml(a)} ${escapeHtml(a.login)}</div>`).join('')
    : none('No one');
  const labels = s.labels.length > 0 ? eventLabelChips(s.labels) : none('None yet');
  const type = s.type ? escapeHtml(s.type.name) : none('No type');
  const milestone = s.milestone ? `<div>${octicon('milestone')} ${escapeHtml(s.milestone.title)}</div>` : none('No milestone');
  const parent = s.parent ? `<div>${octicon('issue-tracks')} #${s.parent.number} ${escapeHtml(s.parent.title)}</div>` : none('None yet');
  return sidebarSection('assignees', 'Assignees', true, assignees)
    + sidebarSection('labels', 'Labels', true, labels)
    + (meta && meta.types.length > 0 ? sidebarSection('type', 'Type', true, type) : '')
    + sidebarSection('milestone', 'Milestone', true, milestone)
    + sidebarSection('parent', 'Parent', true, parent);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, including 6 new `webviewCreate` tests.

Run: `npm run compile`
Expected: no errors. (`issueCreate.ts` still compiles: it doesn't use `IssueTemplate.about`, and Task 6 rewrites it.)

- [ ] **Step 5: Commit**

```bash
git status --short
git add -A .
git commit -m "feat(null-tools): add the New issue form's template chooser and sidebar builders" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The create flow (host + form)

**Files:**
- Modify: `src/issueDetailPanel.ts`, `src/issuesPanel.ts`, `src/issuesPanelIntegration.ts`, `src/webview/shared/picker.ts`, `src/webview/issueDetail.ts`, `lib/issueDetail.css`
- Rewrite: `src/webview/issueCreate.ts`

**Interfaces:**
- Consumes: Task 2's `store.getMetadata()`, `createIssue({ …, milestone })`, `applyCreateExtras`; Task 3's `createComposer`; Task 5's `templateChooserHtml`, `createSidebarHtml`, `CreateSidebarState`; existing `openPicker`, `PickerItem`.
- Produces:
  - `IssueDetailPanel.configure(drafts: vscode.Memento, onCreated: (issue: GithubIssue) => void): void` (replaces Task 4's one-argument form); `IssueDetailPanel.showCreate(extensionUri, store, parent?: { number: number; title: string } | null): Promise<void>`; `IssuesViewProvider.insertCreated(issue)`.
  - Host → webview: `createInit { metadata: DetailMetadata, templates: IssueTemplate[], parent: {number,title} | null, draft: string }`, `setParent { parent }`, `created { number }` (Create more only), `createFailed`.
  - Webview → host: `submitCreate { title, body, labels: string[], assignees: string[], milestone: number | null, typeId: string | null, parent: number | null, createMore: boolean }`, `requestCandidates`, `cancelCreate`, `saveDraft { number: 0, body }`.
  - Webview globals: `pickMany(anchor, title, items, apply)` (moved to `picker.ts`), `renderCreateForm(root, init: CreateInit, io: CreateIo): CreateForm`, `interface CreateForm { candidates(items); setParent(parent); failed(); created(number) }`.

This task changes the message shapes on both sides, so host and form land in one commit. Its automated check is the compiler plus the existing tests; the behavior is verified in Task 8.

- [ ] **Step 1: Host: panel**

In `src/issueDetailPanel.ts`:

1. Replace the `onCreated` field line `private onCreated?: (issue: GithubIssue) => void;` with `private parent: { number: number; title: string } | null = null;`.

2. Replace `configure` (from Task 4) and add the callback holder:

```ts
  /** Told about every issue created from the New issue tab, so the lists can show it before GitHub's search index catches up. */
  private static onCreated: ((issue: GithubIssue) => void) | undefined;

  static configure(drafts: vscode.Memento, onCreated: (issue: GithubIssue) => void): void {
    IssueDetailPanel.drafts = drafts;
    IssueDetailPanel.onCreated = onCreated;
  }
```

3. Replace `showCreate` and `openCreate`:

```ts
  static async showCreate(
    extensionUri: vscode.Uri, store: IssuesStore, parent: { number: number; title: string } | null = null,
  ): Promise<void> {
    const existing = IssueDetailPanel.creatingTab;
    if (existing) {
      existing.panel.reveal();
      if (parent) existing._post({ type: 'setParent', parent }); // keep what the user already typed
      return;
    }
    const tab = new IssueDetailPanel(extensionUri, store);
    IssueDetailPanel.creatingTab = tab;
    await tab.openCreate(parent);
  }
```

```ts
  private async openCreate(parent: { number: number; title: string } | null): Promise<void> {
    this.creating = true;
    this.parent = parent;
    this.panel.title = 'New Issue';
    await this._sendCreateForm();
  }
```

4. Replace `_sendCreateForm` (this also removes Task 2's temporary stubs):

```ts
  private async _sendCreateForm(): Promise<void> {
    // Signed-out/offline must still show the form: Create itself prompts for sign-in (ensureSession(true)), so a
    // form with empty pickers beats no form at all.
    const m = await this.store.getMetadata().catch((): null => null);
    const cwd = this._cwd();
    this._post({
      type: 'createInit',
      metadata: { labels: m?.labels ?? [], assignees: m?.assignees ?? [], milestones: m?.milestones ?? [], types: m?.issueTypes ?? [] },
      templates: cwd ? loadIssueTemplates(cwd) : [],
      parent: this.parent,
      draft: this._readDraft(0),
    });
  }
```

5. Remove `GithubLabel` and `GithubUser` from the `./github/types` import if now unused.

6. Replace `submitCreate`'s type in `InboundMessage` with:

```ts
  | { type: 'submitCreate'; title: string; body: string; labels: string[]; assignees: string[]; milestone: number | null; typeId: string | null; parent: number | null; createMore: boolean }
```

7. Replace the whole `case 'submitCreate': { … }` block with:

```ts
      case 'submitCreate': {
        let created: GithubIssue;
        try {
          created = await this.store.createIssue({
            title: msg.title, body: msg.body, labels: msg.labels, assignees: msg.assignees, milestone: msg.milestone ?? undefined,
          });
        } catch (err) {
          void vscode.window.showErrorMessage(`Failed to create issue: ${(err as Error).message}`);
          this._post({ type: 'createFailed' });
          break;
        }
        this._writeDraft(0, ''); // only now that the issue exists
        const problems = await this.store.applyCreateExtras(created, { typeId: msg.typeId, parent: msg.parent });
        if (problems.length > 0) void vscode.window.showWarningMessage(`Created #${created.number}, but ${problems.join(' and ')}.`);
        if (msg.parent) void IssueDetailPanel.byNumber.get(msg.parent)?._load(false); // its Sub-issues list just grew
        if (msg.createMore) {
          this._post({ type: 'created', number: created.number });
        } else {
          // This tab becomes the new issue's tab.
          if (IssueDetailPanel.creatingTab === this) IssueDetailPanel.creatingTab = undefined;
          IssueDetailPanel.shared ??= this;
          await this.openIssue(created.number);
        }
        // The store already knows the issue (createIssue remembered it); the lists can't search for it yet, so they insert it.
        IssueDetailPanel.onCreated?.(created);
        break;
      }
```

- [ ] **Step 2: Host: provider and registration**

In `src/issuesPanel.ts`, replace `createIssue()` with:

```ts
  async createIssue(): Promise<void> {
    await IssueDetailPanel.showCreate(this._extensionUri, this._store);
  }

  /** The lists show a just-created issue at once instead of waiting for GitHub's search index. */
  insertCreated(issue: GithubIssue): void {
    for (const controller of this._controllers) controller.insertCreated(issue);
  }
```

In `src/issuesPanelIntegration.ts` replace `IssueDetailPanel.configure(context.workspaceState);` with:

```ts
  IssueDetailPanel.configure(context.workspaceState, issue => provider.insertCreated(issue));
```

- [ ] **Step 3: Move `pickMany` into the shared picker**

In `src/webview/issueDetail.ts`, delete the `sameSet` constant and the `pickMany` function (the block starting `const sameSet = …` and ending after `pickMany`'s closing brace, including its two doc comments). In `src/webview/shared/picker.ts`, append:

```ts
/**
 * A multi-select picker that reports the final set once it closes (and only if it changed), like github.com, instead
 * of one request per tick. `items[].selected` is the starting set.
 */
function pickMany(anchor: HTMLElement, title: string, items: PickerItem[], apply: (chosen: Set<string>) => void): void {
  const initial = new Set(items.filter(i => i.selected).map(i => i.value));
  const chosen = new Set(initial);
  openPicker({
    anchor, title, items, multi: true,
    onSelect: v => { if (chosen.has(v)) chosen.delete(v); else chosen.add(v); },
    onClose: () => {
      if (chosen.size !== initial.size || [...initial].some(v => !chosen.has(v))) apply(chosen);
    },
  });
}
```

Run: `grep -n "pickMany\|sameSet" src/webview/issues.ts src/webview/shared/*.ts`
Expected: only the new definition in `picker.ts` (no clash with the list bundle).

- [ ] **Step 4: The form: rewrite `issueCreate.ts`**

Replace the whole of `src/webview/issueCreate.ts` with:

```ts
'use strict';

// The New issue form: a template chooser (when the repo has templates), then a title, a composer for the
// description and a sidebar of pickers. Renders into `root` and owns every click inside it; the entry script
// (issueDetail.ts) only forwards the host messages that belong to the form (see CreateForm).

interface CreateInit {
  metadata: DetailMetadata;
  templates: IssueTemplate[];
  parent: { number: number; title: string } | null;
  /** The unsent description from last time, offered for a blank issue. */
  draft: string;
}

/** What the form needs from the entry script, which it can't see into. */
interface CreateIo {
  post(message: unknown): void;
  toast(message: string): void;
  /** Queues the unsent description for the host to keep as the New issue draft. */
  saveDraftSoon(body: string): void;
  /** Cancels a queued draft save: the issue is being created. */
  dropDraft(): void;
}

/** The host messages the form answers. */
interface CreateForm {
  candidates(items: Array<{ number: number; title: string }>): void;
  setParent(parent: { number: number; title: string }): void;
  failed(): void;
  /** "Create more" succeeded: reset the form for the next issue. */
  created(number: number): void;
}

function renderCreateForm(root: HTMLElement, init: CreateInit, io: CreateIo): CreateForm {
  interface CreateState extends CreateSidebarState { template: IssueTemplate | null; createMore: boolean; busy: boolean; }
  const meta = init.metadata;
  const state: CreateState = {
    assignees: [], labels: [], type: null, milestone: null, parent: init.parent, template: null, createMore: false, busy: false,
  };
  let composer: Composer | null = null;
  let parentAnchor: HTMLElement | null = null;

  const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
  const titleInput = (): HTMLInputElement => byId<HTMLInputElement>('create-title');

  function renderSidebar(): void {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    sidebar.innerHTML = createSidebarHtml(state, meta);
    sidebar.querySelectorAll<HTMLImageElement>('.avatar img').forEach(img =>
      img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true }));
  }

  function showChooser(): void {
    composer = null;
    root.innerHTML = `<div id="create-form">${templateChooserHtml(init.templates)}</div>`;
    byId('create-form').addEventListener('click', onFormClick);
  }

  function showForm(template: IssueTemplate | null): void {
    state.template = template;
    state.labels = (template?.labels ?? [])
      .map(name => meta.labels.find(l => l.name.toLowerCase() === name.toLowerCase()))
      .filter((l): l is GithubLabel => !!l);
    root.innerHTML = `
      <div id="create-form">
        <div class="create-head">
          <h1 class="title">New issue</h1>
          ${init.templates.length > 0 ? '<button type="button" class="link-btn" data-act="change-template">Choose a different template</button>' : ''}
        </div>
        <div id="layout">
          <main id="main">
            <input id="create-title" class="create-title" placeholder="Title" aria-label="Title" autocomplete="off">
            <div id="title-error" class="field-error hidden">Title is required.</div>
            <div id="create-composer"></div>
            <div class="create-actions">
              <label class="create-more"><input type="checkbox" id="create-more"${state.createMore ? ' checked' : ''}> Create more</label>
              <button type="button" class="btn btn-secondary" data-act="cancel-create">Cancel</button>
              <button type="button" class="btn btn-primary" id="create-btn" data-act="submit-create">Create</button>
            </div>
          </main>
          <aside id="sidebar"></aside>
        </div>
      </div>`;
    titleInput().value = template?.title ?? '';
    composer = createComposer({
      value: template ? template.body : init.draft,
      label: 'Description',
      placeholder: 'Describe the issue',
      post: io.post,
      users: () => meta.assignees,
      // Only a blank issue is drafted; a template's text is just the starting point. Nothing is queued once Create was pressed.
      onChange: v => { if (!state.template && !state.busy) io.saveDraftSoon(v); },
      onSubmit: submit,
    });
    byId('create-composer').replaceWith(composer.el);
    renderSidebar();
    byId('create-form').addEventListener('click', onFormClick);
    byId<HTMLInputElement>('create-more').addEventListener('change', e => { state.createMore = (e.target as HTMLInputElement).checked; });
    titleInput().addEventListener('input', () => byId('title-error').classList.add('hidden'));
    titleInput().addEventListener('keydown', e => {
      if (e.isComposing || e.key !== 'Enter') return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) submit(); else composer?.focus();
    });
    titleInput().focus();
  }

  function submit(): void {
    if (state.busy || !composer) return;
    const title = titleInput().value.trim();
    if (!title) {
      byId('title-error').classList.remove('hidden');
      titleInput().focus();
      return;
    }
    state.busy = true;
    const button = byId<HTMLButtonElement>('create-btn');
    button.disabled = true;
    button.textContent = 'Creating…';
    io.dropDraft();
    io.post({
      type: 'submitCreate', title, body: composer.getValue(),
      labels: state.labels.map(l => l.name), assignees: state.assignees.map(a => a.login),
      milestone: state.milestone?.number ?? null, typeId: state.type?.id ?? null, parent: state.parent?.number ?? null,
      createMore: state.createMore,
    });
  }

  // ---- pickers ------------------------------------------------------------------------------------------------

  function pickAssignees(anchor: HTMLElement): void {
    const items = meta.assignees.map(u => ({
      value: u.login, label: u.login, html: `${avatarHtml(u)} ${escapeHtml(u.login)}`,
      selected: state.assignees.some(a => a.login === u.login),
    }));
    pickMany(anchor, 'Assign up to 10 people', items, chosen => {
      state.assignees = meta.assignees.filter(u => chosen.has(u.login));
      renderSidebar();
    });
  }

  function pickLabels(anchor: HTMLElement): void {
    const items = meta.labels.map(l => ({
      value: l.name, label: l.name, html: `<span class="gh-label" style="${labelStyleVars(l.color)}">${escapeHtml(l.name)}</span>`,
      description: l.description ?? undefined, selected: state.labels.some(c => c.name === l.name),
    }));
    pickMany(anchor, 'Apply labels', items, chosen => {
      state.labels = meta.labels.filter(l => chosen.has(l.name));
      renderSidebar();
    });
  }

  function pickMilestone(anchor: HTMLElement): void {
    const items: PickerItem[] = [{ value: '', label: 'No milestone', selected: state.milestone === null }]
      .concat(meta.milestones.map(m => ({ value: String(m.number), label: m.title, selected: m.number === state.milestone?.number })));
    openPicker({
      anchor, title: 'Set milestone', items, filterable: items.length > 8,
      onSelect: v => {
        state.milestone = v === '' ? null : meta.milestones.find(m => String(m.number) === v) ?? null;
        renderSidebar();
      },
    });
  }

  function pickType(anchor: HTMLElement): void {
    const items: PickerItem[] = [{ value: '', label: 'No type', selected: state.type === null }]
      .concat(meta.types.map(t => ({ value: t.id, label: t.name, selected: t.id === state.type?.id })));
    openPicker({
      anchor, title: 'Set issue type', items, filterable: false,
      onSelect: v => {
        state.type = v === '' ? null : meta.types.find(t => t.id === v) ?? null;
        renderSidebar();
      },
    });
  }

  function onFormClick(e: Event): void {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!act) return;
    switch (act.dataset.act) {
      case 'pick-template': {
        const index = Number(act.dataset.index);
        showForm(index >= 0 ? init.templates[index] : null);
        break;
      }
      case 'change-template': showChooser(); break;
      case 'pick-assignees': pickAssignees(act); break;
      case 'pick-labels': pickLabels(act); break;
      case 'pick-milestone': pickMilestone(act); break;
      case 'pick-type': pickType(act); break;
      case 'pick-parent':
        parentAnchor = act;
        io.post({ type: 'requestCandidates' });
        break;
      case 'submit-create': submit(); break;
      case 'cancel-create': io.post({ type: 'cancelCreate' }); break;
    }
  }

  if (init.templates.length > 0) showChooser(); else showForm(null);

  return {
    candidates(items) {
      if (!parentAnchor) return;
      const picks: PickerItem[] = [{ value: '', label: 'No parent', selected: state.parent === null }]
        .concat(items.map(c => ({ value: String(c.number), label: `#${c.number} ${c.title}`, selected: c.number === state.parent?.number })));
      openPicker({
        anchor: parentAnchor, title: 'Set parent issue', items: picks, emptyText: 'No other open issues',
        onSelect: v => {
          state.parent = v === '' ? null : items.find(c => String(c.number) === v) ?? null;
          renderSidebar();
        },
      });
    },
    setParent(parent) {
      state.parent = parent;
      renderSidebar();
    },
    failed() {
      state.busy = false;
      const button = document.getElementById('create-btn') as HTMLButtonElement | null;
      if (button) {
        button.disabled = false;
        button.textContent = 'Create';
      }
    },
    created(number) {
      state.busy = false;
      io.toast(`Created #${number}`);
      // Keeps the template, labels, milestone and parent; the next issue starts with a fresh title, text, assignees and type.
      state.assignees = [];
      state.type = null;
      titleInput().value = state.template?.title ?? '';
      composer?.setValue(state.template?.body ?? '');
      const button = byId<HTMLButtonElement>('create-btn');
      button.disabled = false;
      button.textContent = 'Create';
      renderSidebar();
      titleInput().focus();
    },
  };
}
```

- [ ] **Step 5: The entry script routes the form's messages**

In `src/webview/issueDetail.ts`:

1. Add `let createForm: CreateForm | null = null;` next to the other state variables, and after `post`/`toast` are defined add:

```ts
  const createIo: CreateIo = { post, toast, saveDraftSoon: body => saveDraftSoon(0, body), dropDraft };
```

(`saveDraftSoon` and `dropDraft` are function declarations from Task 4, so they're hoisted.)

2. In `onClick`, the form owns clicks on its own controls. Replace

```ts
    if (actEl) {
      handleAction(actEl.dataset.act!, actEl, e);
      return;
    }
```

with

```ts
    if (actEl) {
      if (!createForm) handleAction(actEl.dataset.act!, actEl, e);
      return;
    }
```

3. In the message handler: at the start of `case 'detail': {` add `createForm = null;` as the first statement. In `case 'error':` add `createForm = null;` before `pageMounted = false;`. Replace `case 'candidates': candidatePicker(msg.items); break;` with:

```ts
      case 'candidates':
        if (createForm) createForm.candidates(msg.items); else candidatePicker(msg.items);
        break;
      case 'setParent': createForm?.setParent(msg.parent); break;
```

Replace the whole `case 'createInit': …` and `case 'createFailed': …` blocks with:

```ts
      case 'createInit':
        pageMounted = false;
        detail = null;
        pending = 0;
        rollback = null;
        createForm = renderCreateForm(root, msg, createIo);
        break;
      case 'createFailed': createForm?.failed(); break;
      case 'created': createForm?.created(msg.number); break;
```

- [ ] **Step 6: Styles**

In `lib/issueDetail.css`: delete the line `#create-form { max-width:900px; }` (the shared `#page, #create-form` rule above it stays), then replace everything from the comment `/* ---- New issue form ---- */` to the end of the file with:

```css
/* ---- New issue form ---- */
.create-head { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:16px; }
.create-title {
  display:block; width:100%; box-sizing:border-box; margin-bottom:8px; padding:8px; font:inherit; border-radius:4px;
  background:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border,transparent);
}
.create-title:focus { outline:none; border-color:var(--vscode-focusBorder); }
.field-error { color:var(--vscode-errorForeground); font-size:.9em; margin:-4px 0 8px; }
#create-composer { margin-bottom:12px; }
.create-actions { display:flex; align-items:center; justify-content:flex-end; gap:8px; }
.create-more { margin-right:auto; display:flex; align-items:center; gap:6px; color:var(--vscode-descriptionForeground); cursor:pointer; }
.template-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px; }
.template-card {
  display:flex; flex-direction:column; gap:4px; padding:12px; text-align:left; cursor:pointer; color:var(--vscode-foreground);
  background:transparent; border:1px solid var(--vscode-widget-border,rgba(128,128,128,.3)); border-radius:6px;
}
.template-card:hover { background:color-mix(in srgb, var(--vscode-foreground) 8%, transparent); border-color:var(--vscode-focusBorder); }
```

Run: `grep -rn "edit-form\|picker-group\|dropdown-\|assignees-label" src lib/issueDetail.css`
Expected: no hits (the old form's classes are gone from both markup and CSS).

- [ ] **Step 7: Build and test**

Run: `grep -rn "getRepoLabels\|getAssignableUsers\|fetchRepoLabels\|fetchAssignableUsers" src`
Expected: no hits.

Run: `npm run compile && npm test`
Expected: no TypeScript errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
git status --short
git add -A .
git commit -m "feat(null-tools): github.com-style New issue form with templates, pickers and Create more" -m "Template chooser, title, composer with drafts, and a sidebar for assignees, labels, type, milestone and parent. Type and parent are applied after the create call and reported, not fatal, if they fail. Finishes #106." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: "Create sub-issue" from the detail tab

**Files:**
- Modify: `src/webview/detailSidebarHtml.ts`, `src/webviewDetail.test.ts`, `src/webview/issueDetail.ts`, `src/issueDetailPanel.ts`

**Interfaces:**
- Consumes: Task 6's `IssueDetailPanel.showCreate(extensionUri, store, parent)`.
- Produces: `data-act="create-sub"` in the sub-issue block (editable viewers only); webview → host `{ type: 'createSubIssue' }`.

- [ ] **Step 1: Write the failing test**

Add to the end of `src/webviewDetail.test.ts`:

```ts
test('subIssuesHtml offers Create sub-issue next to Add only to someone who can edit', () => {
  const subs = [{ id: 'I_8', number: 8, title: 'Done', state: 'closed', stateReason: 'completed', url: 'u', assignees: [] }];
  assert.ok(html.subIssuesHtml(detail({ subIssues: subs })).includes('data-act="create-sub"'));
  assert.ok(!html.subIssuesHtml(detail({ subIssues: subs, post: post({ viewerCanUpdate: false }) })).includes('data-act="create-sub"'));
});
```

Run: `npm test`
Expected: FAIL, the new test.

- [ ] **Step 2: Implement**

In `src/webview/detailSidebarHtml.ts`, in `subIssuesHtml`, replace the line

```ts
      ${canEdit ? `<button type="button" class="btn btn-ghost btn-small" data-act="add-sub">Add sub-issue</button>` : ''}
```

with

```ts
      ${canEdit ? `<button type="button" class="btn btn-ghost btn-small" data-act="add-sub">Add existing</button>
      <button type="button" class="btn btn-ghost btn-small" data-act="create-sub">Create sub-issue</button>` : ''}
```

In `src/webview/issueDetail.ts`:
- In `headerMenu`, change `if (detail?.post.viewerCanUpdate) items.push({ value: 'sub', label: 'Add sub-issue…' });` to:

```ts
    if (detail?.post.viewerCanUpdate) {
      items.push({ value: 'sub', label: 'Add existing sub-issue…' }, { value: 'create-sub', label: 'Create sub-issue…' });
    }
```

  and in its `onSelect` add `else if (action === 'create-sub') post({ type: 'createSubIssue' });` after the `'sub'` branch.
- In `handleAction` add `case 'create-sub': post({ type: 'createSubIssue' }); break;` next to `case 'add-sub'`.

In `src/issueDetailPanel.ts`: add `| { type: 'createSubIssue' }` to `InboundMessage`, and this case before `case 'openIssue':`:

```ts
      case 'createSubIssue':
        await IssueDetailPanel.showCreate(this.extensionUri, this.store, { number, title: this.store.getByNumber(number)?.title ?? '' });
        break;
```

- [ ] **Step 3: Verify**

Run: `npm run compile && npm test`
Expected: PASS, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git status --short
git add -A .
git commit -m "feat(null-tools): create a sub-issue from an issue's tab" -m "Opens the New issue form with the Parent preset; an already open form keeps its text and just gets the parent." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs and live verification

**Files:**
- Modify: `CLAUDE.md` (repo root)

- [ ] **Step 1: Update CLAUDE.md**

In the `null-tools` table row **GitHub Issues panel**, replace the phrase `create/comment on issues, sign-in,` with `a Write/Preview composer (toolbar, shortcuts, @/# autocomplete, drafts kept per issue) for comments and edits, a New issue tab (template chooser, sidebar pickers, Create more, sub-issue creation), sign-in,`.

- [ ] **Step 2: Verify against a real install**

Invoke the `verify-local` skill (it syncs the extension into the real local Null IDE install and runs the extension's integration specs). Then go through these by hand in that install, on `TorresVisual/null-ide`, and report each as passed or failed with what you saw:

1. **Cold create.** Reload the window, run *Null: Create issue* from the Command Palette before opening the Issues sidebar. The form opens, its Labels/Assignees pickers are populated, and Create works.
2. **Templates.** Add an untracked `.github/ISSUE_TEMPLATE/bug.md` with front matter `name: Bug report`, `about: Something broke`, `labels: bug` and a body. Reopen *Create issue*: the chooser shows *Bug report* with its about line plus *Blank issue*. Picking the template fills title/body and pre-selects the `bug` label; *Choose a different template* returns to the chooser. Delete the file afterwards.
3. **Double-click Create** creates exactly one issue.
4. **Empty title** shows "Title is required." and sends nothing; a whitespace-only title too.
5. **Create more.** Tick it, create twice: the form resets (title/body/assignees/type) but keeps labels, milestone and parent; "Created #n" toast each time; the issue does not open.
6. **Drafts don't cross.** Type in issue #A's comment box, switch to issue #B in the same tab within 500 ms, wait, then return to #A: the text is under #A, #B's box is empty. Close #A's tab with text in the box and reopen #A: text restored.
7. **Drafts don't come back.** Post that comment, close and reopen the tab: the box is empty. Create an issue from a typed blank form, reopen *Create issue*: the description is empty. A *failed* post (go offline, press Comment) keeps the text.
8. **Preview.** Write `**bold** #1 @TorresVisual` in a comment, open Preview: it matches what github.com shows after posting (links for `#1`/`@user`). Offline, Preview shows an error line, not a blank pane.
9. **Out-of-order replies.** Type `#` + two letters, keep typing quickly: the popup never shows results for an older prefix. Click Preview, then Write before it loads, then Preview again: no stale or duplicated render.
10. **Edit and Esc.** Edit a comment: change text, press Esc once (hint "Press Esc again…"), type a character (hint disappears), Esc twice discards. Ctrl+Enter saves. While editing, leave and refocus the tab (a refresh arrives): text and caret survive. Clearing a *comment* and saving shows "A comment can't be empty."
11. **Quote reply** puts `> …` into the new-comment box, with the selected text if any, and focuses it.
12. **Shortcuts.** Ctrl+B, Ctrl+I, Ctrl+E, Ctrl+K do their composer action rather than toggling the sidebar / opening Quick Open / starting a chord. If VS Code keeps one of them, delete that tool's `key` in `COMPOSER_TOOLS` (`src/webview/composerText.ts`), keep the toolbar button, and say so in the report. Ctrl+Z after a toolbar action undoes just that action.
13. **Hostile text.** Create an issue titled `<img src=x onerror=alert(1)>` with body `</textarea><script>1</script>` and a comment `@a<b`: everything shows as literal text in the composer, the preview and both popups.
14. **Menus.** Triggers don't fire in `me@example.com`, `http://x/#frag`, or a `# Heading` line; they do after a space or `(`. Toolbar buttons wrap/insert as the labels say; the popup follows the caret and Enter/Tab accepts, Esc closes it only.
15. **Sub-issue.** On an issue's tab use *Create sub-issue*: the form has Parent preset; after Create the issue opens, and the parent's tab (if open) lists it under Sub-issues. Triggering it again while the form is open keeps what was typed.
16. **Signed out / offline.** Sign out of GitHub in the IDE, run *Create issue*: the form opens with empty pickers and Create prompts for sign-in. Offline: Create shows an error and the form stays filled.

- [ ] **Step 3: Commit**

```bash
git status --short
git add CLAUDE.md
git commit -m "docs: describe the Issues composer and New issue form" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

If any step 2 scenario failed, fix it as a follow-up commit (`fix(null-tools): …`) before this one, and say which scenario it was.
