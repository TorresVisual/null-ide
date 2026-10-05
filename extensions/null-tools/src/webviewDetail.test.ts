'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// The detail tab's HTML builders are plain top-level functions in a `module: none` bundle, so load the compiled
// bundle into a sandbox (built by `tsc -p tsconfig.webview-shared.json`) and call them like webviewShared.test.ts does.
const sandbox = vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname, 'webview-shared.js'), 'utf8'), sandbox);

type Post = Record<string, unknown>;
const html = sandbox as unknown as {
  neutralizeImagesHtml(h: string): string;
  issueNumberFromLink(href: string, repo: string): number | null;
  eventHtml(ev: Record<string, unknown>): string;
  postHtml(post: Post, kind: 'body' | 'comment', editing: boolean): string;
  reactionPickerItems(post: Post): Array<{ value: string; selected?: boolean }>;
  sidebarHtml(d: Record<string, unknown>, meta: Record<string, unknown> | null, viewer: string | null): string;
  subIssuesHtml(d: Record<string, unknown>): string;
};

const user = { login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' };
const post = (over: Post = {}): Post => ({
  id: 'IC_1', url: 'https://github.com/o/r/issues/7#issuecomment-1', author: user, authorAssociation: 'OWNER',
  createdAt: '2026-10-01T10:00:00Z', lastEditedAt: null, bodyHTML: '<p>Hello</p>', body: 'Hello', reactions: [],
  viewerCanUpdate: true, viewerCanDelete: true, minimizedReason: null, ...over,
});

test('neutralizeImagesHtml turns images into placeholders and emoji into their text', () => {
  const out = html.neutralizeImagesHtml(
    '<p><img src="https://github.com/user-attachments/assets/1" alt="shot" width="10"> '
    + '<img class="emoji" title=":+1:" alt="👍" src="https://github.githubassets.com/e.png" height="20"></p>');
  assert.ok(!/<img/i.test(out));
  assert.match(out, /<span class="img-placeholder" data-src="https:\/\/github.com\/user-attachments\/assets\/1"[^>]*>.*shot<\/span>/);
  assert.ok(out.includes('👍'));
});

test('neutralizeImagesHtml reads src, not data-canonical-src, and labels an image without alt text', () => {
  const out = html.neutralizeImagesHtml('<img data-canonical-src="https://x/orig.png" src="https://camo.githubusercontent.com/abc">');
  assert.ok(out.includes('data-src="https://camo.githubusercontent.com/abc"'));
  assert.match(out, /> image<\/span>$/);
});

test('neutralizeImagesHtml does not let a raw < in alt text become markup', () => {
  const out = html.neutralizeImagesHtml('<img src="https://x/y.png" alt="<script>alert(1)</script>">');
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
});

test('neutralizeImagesHtml keeps the alt text, escaped, in data-alt for the thumbnail', () => {
  const out = html.neutralizeImagesHtml('<img src="https://x/y.png" alt="a &quot;b&quot; <i>">');
  assert.ok(out.includes('data-alt="a &quot;b&quot; &lt;i&gt;"'), out);
  assert.ok(!out.includes('<i>'));
});

test('issueNumberFromLink recognises only issue links of this repo', () => {
  assert.strictEqual(html.issueNumberFromLink('https://github.com/O/R/issues/12', 'o/r'), 12);
  assert.strictEqual(html.issueNumberFromLink('https://github.com/o/r/issues/12#issuecomment-5', 'o/r'), 12);
  assert.strictEqual(html.issueNumberFromLink('https://github.com/o/other/issues/12', 'o/r'), null);
  assert.strictEqual(html.issueNumberFromLink('https://github.com/o/r/pull/12', 'o/r'), null);
  assert.strictEqual(html.issueNumberFromLink('http://github.com/o/r/issues/12', 'o/r'), null);
  assert.strictEqual(html.issueNumberFromLink('https://github.com.evil.example/o/r/issues/12', 'o/r'), null);
  assert.strictEqual(html.issueNumberFromLink('https://github.com/o/r/issues/12evil', 'o/r'), null);
});

test('eventHtml escapes titles and logins instead of trusting them', () => {
  const out = html.eventHtml({
    kind: 'event', at: '2026-10-01T10:00:00Z', actor: '<b>x</b>', type: 'renamed', from: '<img src=x onerror=alert(1)>', to: 'ok',
  });
  assert.ok(!out.includes('<img src=x'));
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(out.includes('&lt;b&gt;x&lt;/b&gt;'));
});

test('eventHtml words closing, labels and self-assignment like github.com', () => {
  const closed = html.eventHtml({
    kind: 'event', at: '2026-10-01T10:00:00Z', actor: 'octocat', type: 'closed', reason: 'not_planned',
    closer: { text: '#12', url: 'https://github.com/o/r/pull/12' },
  });
  assert.match(closed, /closed this as not planned in <a href="https:\/\/github.com\/o\/r\/pull\/12">#12<\/a>/);
  assert.ok(closed.includes('state-not-planned'));
  const labels = html.eventHtml({
    kind: 'event', at: '2026-10-01T10:00:00Z', actor: 'octocat', type: 'labels',
    added: [{ name: 'bug', color: 'd73a4a' }, { name: 'ui', color: '0075ca' }], removed: [{ name: 'wip', color: 'ffffff' }],
  });
  assert.match(labels, /added .*bug.*ui.* labels and removed .*wip.* label /);
  const self = html.eventHtml({ kind: 'event', at: '2026-10-01T10:00:00Z', actor: 'octocat', type: 'assigned', login: 'octocat' });
  assert.ok(self.includes('self-assigned this'));
  const plain = html.eventHtml({ kind: 'event', at: '2026-10-01T10:00:00Z', actor: 'octocat', type: 'closed', reason: null, closer: null });
  assert.ok(plain.includes('closed this <'));
});

test('postHtml shows role badge, edited marker and escapes the author', () => {
  const out = html.postHtml(post({ author: { login: '<i>', avatar_url: '' }, lastEditedAt: '2026-10-01T11:00:00Z' }), 'comment', false);
  assert.ok(out.includes('role-badge">Owner<'));
  assert.ok(out.includes('· edited'));
  assert.ok(out.includes('&lt;i&gt;'));
  assert.ok(out.includes('commented'));
  assert.ok(html.postHtml(post({ authorAssociation: 'NONE' }), 'comment', false).indexOf('role-badge') === -1);
  assert.ok(html.postHtml(post(), 'body', false).includes('opened this'));
});

test('postHtml folds minimized comments and shows only reactions someone used', () => {
  const folded = html.postHtml(post({ minimizedReason: 'off_topic' }), 'comment', false);
  assert.match(folded, /^\s*<details class="post-minimized"><summary>This comment was marked as off topic\. Show<\/summary>/);
  const reacted = html.postHtml(post({
    reactions: [
      { content: 'THUMBS_UP', count: 2, viewerHasReacted: true },
      { content: 'EYES', count: 0, viewerHasReacted: false },
    ],
  }), 'comment', false);
  assert.ok(reacted.includes('reaction-chip active'));
  assert.ok(reacted.includes('👍 2'));
  assert.ok(!reacted.includes('👀'));
});

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

test('reactionPickerItems offers GitHub\'s eight and checks the viewer\'s own', () => {
  const items = html.reactionPickerItems(post({ reactions: [{ content: 'HEART', count: 1, viewerHasReacted: true }] }));
  assert.strictEqual(items.length, 8);
  // Arrays from the vm realm have a different Array.prototype; copy before deep-comparing.
  assert.deepStrictEqual(Array.from(items.filter(i => i.selected).map(i => i.value)), ['HEART']);
});

const detail = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'I_7',
  issue: { number: 7, title: 'T', body: '', state: 'open', html_url: 'u', labels: [], assignees: [], user, comments: 0, updated_at: '' },
  post: post(), issueType: null, milestone: null, parent: null, subIssues: [], linkedPrs: [], participants: [user],
  timeline: [], hasMoreTimeline: false, timelineCursor: null, ...over,
});

test('sidebarHtml leaves out Type on repos without issue types, and shows it once the issue has one', () => {
  assert.ok(!html.sidebarHtml(detail(), { types: [] }, 'octocat').includes('data-sec="type"'));
  assert.ok(!html.sidebarHtml(detail(), null, 'octocat').includes('data-sec="type"'));
  assert.ok(html.sidebarHtml(detail(), { types: [{ id: 'T', name: 'Bug' }] }, 'octocat').includes('data-sec="type"'));
  assert.ok(html.sidebarHtml(detail({ issueType: { id: 'T', name: 'Bug' } }), null, 'octocat').includes('data-sec="type"'));
});

test('sidebarHtml shows edit gears and "assign yourself" only to someone who can edit', () => {
  const editable = html.sidebarHtml(detail(), null, 'octocat');
  assert.ok(editable.includes('data-act="pick-assignees"'));
  assert.ok(editable.includes('data-act="assign-me"'));
  const readOnly = html.sidebarHtml(detail({ post: post({ viewerCanUpdate: false }) }), null, 'octocat');
  assert.ok(!readOnly.includes('data-act="pick-'));
  assert.ok(!readOnly.includes('data-act="assign-me"'));
  assert.ok(!html.sidebarHtml(detail(), null, null).includes('data-act="assign-me"'));
});

test('sidebarHtml lists linked pull requests with their state and the empty states otherwise', () => {
  const out = html.sidebarHtml(detail({
    linkedPrs: [{ number: 9, title: 'Fix <it>', state: 'merged', isDraft: false, url: 'https://github.com/o/r/pull/9' }],
  }), null, 'octocat');
  assert.ok(out.includes('pr-merged'));
  assert.ok(out.includes('Fix &lt;it&gt;'));
  assert.ok(out.includes('No one'));
  assert.ok(out.includes('No milestone'));
  assert.ok(out.includes('None yet'));
});

test('subIssuesHtml is empty without children; otherwise counts closed ones and offers remove only when editable', () => {
  assert.strictEqual(html.subIssuesHtml(detail()), '');
  const subs = [
    { id: 'I_8', number: 8, title: 'Done', state: 'closed', stateReason: 'completed', url: 'u', assignees: [] },
    { id: 'I_9', number: 9, title: 'Todo', state: 'open', stateReason: null, url: 'u', assignees: [user] },
  ];
  const out = html.subIssuesHtml(detail({ subIssues: subs }));
  assert.ok(out.includes('1 of 2'));
  assert.ok(out.includes('width:50%'));
  assert.ok(out.includes('data-act="sub-menu"'));
  const readOnly = html.subIssuesHtml(detail({ subIssues: subs, post: post({ viewerCanUpdate: false }) }));
  assert.ok(!readOnly.includes('data-act="sub-menu"'));
  assert.ok(!readOnly.includes('data-act="add-sub"'));
});

test('subIssuesHtml offers Create sub-issue next to Add only to someone who can edit', () => {
  const subs = [{ id: 'I_8', number: 8, title: 'Done', state: 'closed', stateReason: 'completed', url: 'u', assignees: [] }];
  assert.ok(html.subIssuesHtml(detail({ subIssues: subs })).includes('data-act="create-sub"'));
  assert.ok(!html.subIssuesHtml(detail({ subIssues: subs, post: post({ viewerCanUpdate: false }) })).includes('data-act="create-sub"'));
});
