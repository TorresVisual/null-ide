'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const pullActionsModel_1 = require("./pullActionsModel");
const facts = (over = {}) => ({
    state: 'open', draft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
    viewerCanUpdate: true, viewerDidAuthor: false, viewerPermission: 'WRITE',
    mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false, pendingComments: null, ...over,
});
(0, node_test_1.default)('an open, clean PR you can write to: everything is on offer', () => {
    node_assert_1.default.deepStrictEqual((0, pullActionsModel_1.pageActions)(facts()), {
        review: { available: true, canApprove: true, pending: null },
        merge: { enabled: true, hint: 'Ready to merge.', methods: ['MERGE', 'SQUASH'] },
        state: 'close', draft: 'draft',
    });
});
(0, node_test_1.default)('merge is disabled, with the reason, for a draft, conflicts, read access, or no allowed method', () => {
    const merge = (over) => (0, pullActionsModel_1.pageActions)(facts(over)).merge;
    node_assert_1.default.deepStrictEqual([merge({ draft: true }).enabled, merge({ draft: true }).hint], [false, 'Mark this as ready for review to merge it.']);
    node_assert_1.default.deepStrictEqual([merge({ mergeable: 'CONFLICTING' }).enabled, merge({ mergeable: 'CONFLICTING' }).hint], [false, 'This branch has conflicts that must be resolved first.']);
    node_assert_1.default.deepStrictEqual([merge({ viewerPermission: 'READ' }).enabled, merge({ viewerPermission: 'TRIAGE' }).enabled], [false, false]);
    node_assert_1.default.match(merge({ viewerPermission: 'READ' }).hint, /write access/);
    const none = merge({ mergeCommitAllowed: false, squashMergeAllowed: false, rebaseMergeAllowed: false });
    node_assert_1.default.deepStrictEqual([none.enabled, none.methods, none.hint], [false, [], 'This repository allows no merge method.']);
});
(0, node_test_1.default)('merge stays enabled when GitHub only says blocked, behind or unstable: the repository may let you through, GitHub decides', () => {
    for (const status of ['BLOCKED', 'BEHIND', 'UNSTABLE']) {
        const m = (0, pullActionsModel_1.pageActions)(facts({ mergeStateStatus: status })).merge;
        node_assert_1.default.strictEqual(m.enabled, true, status);
        node_assert_1.default.notStrictEqual(m.hint, '', status);
    }
    node_assert_1.default.strictEqual((0, pullActionsModel_1.pageActions)(facts({ mergeStateStatus: 'SOMETHING_NEW' })).merge.hint, '', 'an unknown status says nothing');
    node_assert_1.default.strictEqual((0, pullActionsModel_1.pageActions)(facts({ mergeStateStatus: 'SOMETHING_NEW' })).merge.enabled, true);
});
(0, node_test_1.default)('merge method order is merge, squash, rebase and only the allowed ones', () => {
    node_assert_1.default.deepStrictEqual((0, pullActionsModel_1.pageActions)(facts({ mergeCommitAllowed: false, squashMergeAllowed: true, rebaseMergeAllowed: true })).merge.methods, ['SQUASH', 'REBASE']);
});
(0, node_test_1.default)('closed and merged PRs: nothing to merge; closed can be reopened, merged is final', () => {
    const closed = (0, pullActionsModel_1.pageActions)(facts({ state: 'closed' }));
    node_assert_1.default.deepStrictEqual([closed.merge.enabled, closed.merge.hint, closed.state, closed.draft, closed.review.available], [false, '', 'reopen', null, false]);
    const merged = (0, pullActionsModel_1.pageActions)(facts({ state: 'merged' }));
    node_assert_1.default.deepStrictEqual([merged.merge.enabled, merged.state, merged.draft, merged.review.available], [false, null, null, false]);
});
(0, node_test_1.default)('close and draft follow viewerCanUpdate and the current draft state', () => {
    node_assert_1.default.deepStrictEqual([(0, pullActionsModel_1.pageActions)(facts({ draft: true })).draft, (0, pullActionsModel_1.pageActions)(facts({ draft: false })).draft], ['ready', 'draft']);
    const readOnly = (0, pullActionsModel_1.pageActions)(facts({ viewerCanUpdate: false }));
    node_assert_1.default.deepStrictEqual([readOnly.state, readOnly.draft], [null, null]);
});
(0, node_test_1.default)('your own PR cannot be approved; a pending review is reported with its comment count', () => {
    node_assert_1.default.strictEqual((0, pullActionsModel_1.pageActions)(facts({ viewerDidAuthor: true })).review.canApprove, false);
    node_assert_1.default.strictEqual((0, pullActionsModel_1.pageActions)(facts({ pendingComments: 3 })).review.pending, 3);
});
(0, node_test_1.default)('reviewChoices: approve and request changes are hidden on your own PR; discard only when something is pending', () => {
    const labels = (s) => (0, pullActionsModel_1.reviewChoices)(s).map(o => o.choice);
    node_assert_1.default.deepStrictEqual(labels({ viewerIsAuthor: false, reviewId: null, comments: 0 }), ['COMMENT', 'APPROVE', 'REQUEST_CHANGES']);
    node_assert_1.default.deepStrictEqual(labels({ viewerIsAuthor: true, reviewId: null, comments: 0 }), ['COMMENT']);
    node_assert_1.default.deepStrictEqual(labels({ viewerIsAuthor: false, reviewId: 'R', comments: 2 }), ['COMMENT', 'APPROVE', 'REQUEST_CHANGES', 'DISCARD']);
    node_assert_1.default.match((0, pullActionsModel_1.reviewChoices)({ viewerIsAuthor: false, reviewId: 'R', comments: 1 })[0].description, /1 pending comment\b/);
    node_assert_1.default.match((0, pullActionsModel_1.reviewChoices)({ viewerIsAuthor: false, reviewId: 'R', comments: 2 })[0].description, /2 pending comments/);
    node_assert_1.default.doesNotMatch((0, pullActionsModel_1.reviewChoices)({ viewerIsAuthor: false, reviewId: 'R', comments: 0 })[0].description, /pending/);
});
(0, node_test_1.default)('reviewBodyError: requesting changes needs a body; a bare comment needs a body unless comments are pending; approving never does', () => {
    node_assert_1.default.match((0, pullActionsModel_1.reviewBodyError)('REQUEST_CHANGES', 5, ''), /what needs to change/);
    node_assert_1.default.match((0, pullActionsModel_1.reviewBodyError)('REQUEST_CHANGES', 0, '   \n'), /what needs to change/, 'whitespace is empty');
    node_assert_1.default.match((0, pullActionsModel_1.reviewBodyError)('COMMENT', 0, ''), /Write a comment/);
    node_assert_1.default.strictEqual((0, pullActionsModel_1.reviewBodyError)('COMMENT', 2, ''), undefined);
    node_assert_1.default.strictEqual((0, pullActionsModel_1.reviewBodyError)('APPROVE', 0, ''), undefined);
    node_assert_1.default.strictEqual((0, pullActionsModel_1.reviewBodyError)('REQUEST_CHANGES', 0, 'fix x'), undefined);
});
//# sourceMappingURL=pullActionsModel.test.js.map