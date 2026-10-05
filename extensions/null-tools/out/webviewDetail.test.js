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
// The detail tab's HTML builders are plain top-level functions in a `module: none` bundle, so load the compiled
// bundle into a sandbox (built by `tsc -p tsconfig.webview-shared.json`) and call them like webviewShared.test.ts does.
const sandbox = node_vm_1.default.createContext({});
node_vm_1.default.runInContext((0, node_fs_1.readFileSync)(node_path_1.default.join(__dirname, 'webview-shared.js'), 'utf8'), sandbox);
const html = sandbox;
const user = { login: 'octocat', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' };
const post = (over = {}) => ({
    id: 'IC_1', url: 'https://github.com/o/r/issues/7#issuecomment-1', author: user, authorAssociation: 'OWNER',
    createdAt: '2026-10-01T10:00:00Z', lastEditedAt: null, bodyHTML: '<p>Hello</p>', body: 'Hello', reactions: [],
    viewerCanUpdate: true, viewerCanDelete: true, minimizedReason: null, ...over,
});
(0, node_test_1.default)('neutralizeImagesHtml turns images into placeholders and emoji into their text', () => {
    const out = html.neutralizeImagesHtml('<p><img src="https://github.com/user-attachments/assets/1" alt="shot" width="10"> '
        + '<img class="emoji" title=":+1:" alt="👍" src="https://github.githubassets.com/e.png" height="20"></p>');
    node_assert_1.default.ok(!/<img/i.test(out));
    node_assert_1.default.match(out, /<span class="img-placeholder" data-src="https:\/\/github.com\/user-attachments\/assets\/1"[^>]*>.*shot<\/span>/);
    node_assert_1.default.ok(out.includes('👍'));
});
(0, node_test_1.default)('neutralizeImagesHtml reads src, not data-canonical-src, and labels an image without alt text', () => {
    const out = html.neutralizeImagesHtml('<img data-canonical-src="https://x/orig.png" src="https://camo.githubusercontent.com/abc">');
    node_assert_1.default.ok(out.includes('data-src="https://camo.githubusercontent.com/abc"'));
    node_assert_1.default.match(out, /> image<\/span>$/);
});
(0, node_test_1.default)('neutralizeImagesHtml does not let a raw < in alt text become markup', () => {
    const out = html.neutralizeImagesHtml('<img src="https://x/y.png" alt="<script>alert(1)</script>">');
    node_assert_1.default.ok(!out.includes('<script>'));
    node_assert_1.default.ok(out.includes('&lt;script&gt;'));
});
(0, node_test_1.default)('issueNumberFromLink recognises only issue links of this repo', () => {
    node_assert_1.default.strictEqual(html.issueNumberFromLink('https://github.com/O/R/issues/12', 'o/r'), 12);
    node_assert_1.default.strictEqual(html.issueNumberFromLink('https://github.com/o/r/issues/12#issuecomment-5', 'o/r'), 12);
    node_assert_1.default.strictEqual(html.issueNumberFromLink('https://github.com/o/other/issues/12', 'o/r'), null);
    node_assert_1.default.strictEqual(html.issueNumberFromLink('https://github.com/o/r/pull/12', 'o/r'), null);
    node_assert_1.default.strictEqual(html.issueNumberFromLink('http://github.com/o/r/issues/12', 'o/r'), null);
    node_assert_1.default.strictEqual(html.issueNumberFromLink('https://github.com.evil.example/o/r/issues/12', 'o/r'), null);
    node_assert_1.default.strictEqual(html.issueNumberFromLink('https://github.com/o/r/issues/12evil', 'o/r'), null);
});
(0, node_test_1.default)('eventHtml escapes titles and logins instead of trusting them', () => {
    const out = html.eventHtml({
        kind: 'event', at: '2026-10-01T10:00:00Z', actor: '<b>x</b>', type: 'renamed', from: '<img src=x onerror=alert(1)>', to: 'ok',
    });
    node_assert_1.default.ok(!out.includes('<img src=x'));
    node_assert_1.default.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'));
    node_assert_1.default.ok(out.includes('&lt;b&gt;x&lt;/b&gt;'));
});
(0, node_test_1.default)('eventHtml words closing, labels and self-assignment like github.com', () => {
    const closed = html.eventHtml({
        kind: 'event', at: '2026-10-01T10:00:00Z', actor: 'octocat', type: 'closed', reason: 'not_planned',
        closer: { text: '#12', url: 'https://github.com/o/r/pull/12' },
    });
    node_assert_1.default.match(closed, /closed this as not planned in <a href="https:\/\/github.com\/o\/r\/pull\/12">#12<\/a>/);
    node_assert_1.default.ok(closed.includes('state-not-planned'));
    const labels = html.eventHtml({
        kind: 'event', at: '2026-10-01T10:00:00Z', actor: 'octocat', type: 'labels',
        added: [{ name: 'bug', color: 'd73a4a' }, { name: 'ui', color: '0075ca' }], removed: [{ name: 'wip', color: 'ffffff' }],
    });
    node_assert_1.default.match(labels, /added .*bug.*ui.* labels and removed .*wip.* label /);
    const self = html.eventHtml({ kind: 'event', at: '2026-10-01T10:00:00Z', actor: 'octocat', type: 'assigned', login: 'octocat' });
    node_assert_1.default.ok(self.includes('self-assigned this'));
    const plain = html.eventHtml({ kind: 'event', at: '2026-10-01T10:00:00Z', actor: 'octocat', type: 'closed', reason: null, closer: null });
    node_assert_1.default.ok(plain.includes('closed this <'));
});
(0, node_test_1.default)('postHtml shows role badge, edited marker and escapes the author', () => {
    const out = html.postHtml(post({ author: { login: '<i>', avatar_url: '' }, lastEditedAt: '2026-10-01T11:00:00Z' }), 'comment', false);
    node_assert_1.default.ok(out.includes('role-badge">Owner<'));
    node_assert_1.default.ok(out.includes('· edited'));
    node_assert_1.default.ok(out.includes('&lt;i&gt;'));
    node_assert_1.default.ok(out.includes('commented'));
    node_assert_1.default.ok(html.postHtml(post({ authorAssociation: 'NONE' }), 'comment', false).indexOf('role-badge') === -1);
    node_assert_1.default.ok(html.postHtml(post(), 'body', false).includes('opened this'));
});
(0, node_test_1.default)('postHtml folds minimized comments and shows only reactions someone used', () => {
    const folded = html.postHtml(post({ minimizedReason: 'off_topic' }), 'comment', false);
    node_assert_1.default.match(folded, /^\s*<details class="post-minimized"><summary>This comment was marked as off topic\. Show<\/summary>/);
    const reacted = html.postHtml(post({
        reactions: [
            { content: 'THUMBS_UP', count: 2, viewerHasReacted: true },
            { content: 'EYES', count: 0, viewerHasReacted: false },
        ],
    }), 'comment', false);
    node_assert_1.default.ok(reacted.includes('reaction-chip active'));
    node_assert_1.default.ok(reacted.includes('👍 2'));
    node_assert_1.default.ok(!reacted.includes('👀'));
});
(0, node_test_1.default)('postHtml in edit mode leaves a slot for the composer and never inlines the markdown source', () => {
    const out = html.postHtml(post({ body: 'a </textarea><script>x</script>' }), 'comment', true);
    node_assert_1.default.ok(out.includes('class="composer-slot" data-id="IC_1"'));
    node_assert_1.default.ok(!out.includes('post-body'));
    node_assert_1.default.ok(!out.includes('<script>'));
    node_assert_1.default.ok(!out.includes('</textarea>'));
    node_assert_1.default.ok(!out.includes('a &lt;/textarea&gt;'), 'the source is set as a value by the composer, not written into markup');
    node_assert_1.default.ok(out.includes('data-act="save-edit"'));
    node_assert_1.default.ok(out.includes('data-act="cancel-edit"'));
});
(0, node_test_1.default)('reactionPickerItems offers GitHub\'s eight and checks the viewer\'s own', () => {
    const items = html.reactionPickerItems(post({ reactions: [{ content: 'HEART', count: 1, viewerHasReacted: true }] }));
    node_assert_1.default.strictEqual(items.length, 8);
    // Arrays from the vm realm have a different Array.prototype; copy before deep-comparing.
    node_assert_1.default.deepStrictEqual(Array.from(items.filter(i => i.selected).map(i => i.value)), ['HEART']);
});
const detail = (over = {}) => ({
    id: 'I_7',
    issue: { number: 7, title: 'T', body: '', state: 'open', html_url: 'u', labels: [], assignees: [], user, comments: 0, updated_at: '' },
    post: post(), issueType: null, milestone: null, parent: null, subIssues: [], linkedPrs: [], participants: [user],
    timeline: [], hasMoreTimeline: false, timelineCursor: null, ...over,
});
(0, node_test_1.default)('sidebarHtml leaves out Type on repos without issue types, and shows it once the issue has one', () => {
    node_assert_1.default.ok(!html.sidebarHtml(detail(), { types: [] }, 'octocat').includes('data-sec="type"'));
    node_assert_1.default.ok(!html.sidebarHtml(detail(), null, 'octocat').includes('data-sec="type"'));
    node_assert_1.default.ok(html.sidebarHtml(detail(), { types: [{ id: 'T', name: 'Bug' }] }, 'octocat').includes('data-sec="type"'));
    node_assert_1.default.ok(html.sidebarHtml(detail({ issueType: { id: 'T', name: 'Bug' } }), null, 'octocat').includes('data-sec="type"'));
});
(0, node_test_1.default)('sidebarHtml shows edit gears and "assign yourself" only to someone who can edit', () => {
    const editable = html.sidebarHtml(detail(), null, 'octocat');
    node_assert_1.default.ok(editable.includes('data-act="pick-assignees"'));
    node_assert_1.default.ok(editable.includes('data-act="assign-me"'));
    const readOnly = html.sidebarHtml(detail({ post: post({ viewerCanUpdate: false }) }), null, 'octocat');
    node_assert_1.default.ok(!readOnly.includes('data-act="pick-'));
    node_assert_1.default.ok(!readOnly.includes('data-act="assign-me"'));
    node_assert_1.default.ok(!html.sidebarHtml(detail(), null, null).includes('data-act="assign-me"'));
});
(0, node_test_1.default)('sidebarHtml lists linked pull requests with their state and the empty states otherwise', () => {
    const out = html.sidebarHtml(detail({
        linkedPrs: [{ number: 9, title: 'Fix <it>', state: 'merged', isDraft: false, url: 'https://github.com/o/r/pull/9' }],
    }), null, 'octocat');
    node_assert_1.default.ok(out.includes('pr-merged'));
    node_assert_1.default.ok(out.includes('Fix &lt;it&gt;'));
    node_assert_1.default.ok(out.includes('No one'));
    node_assert_1.default.ok(out.includes('No milestone'));
    node_assert_1.default.ok(out.includes('None yet'));
});
(0, node_test_1.default)('subIssuesHtml is empty without children; otherwise counts closed ones and offers remove only when editable', () => {
    node_assert_1.default.strictEqual(html.subIssuesHtml(detail()), '');
    const subs = [
        { id: 'I_8', number: 8, title: 'Done', state: 'closed', stateReason: 'completed', url: 'u', assignees: [] },
        { id: 'I_9', number: 9, title: 'Todo', state: 'open', stateReason: null, url: 'u', assignees: [user] },
    ];
    const out = html.subIssuesHtml(detail({ subIssues: subs }));
    node_assert_1.default.ok(out.includes('1 of 2'));
    node_assert_1.default.ok(out.includes('width:50%'));
    node_assert_1.default.ok(out.includes('data-act="sub-menu"'));
    const readOnly = html.subIssuesHtml(detail({ subIssues: subs, post: post({ viewerCanUpdate: false }) }));
    node_assert_1.default.ok(!readOnly.includes('data-act="sub-menu"'));
    node_assert_1.default.ok(!readOnly.includes('data-act="add-sub"'));
});
//# sourceMappingURL=webviewDetail.test.js.map