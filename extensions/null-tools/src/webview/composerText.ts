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
