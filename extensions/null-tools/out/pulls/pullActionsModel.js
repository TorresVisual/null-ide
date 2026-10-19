'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.pageActions = pageActions;
exports.reviewChoices = reviewChoices;
exports.reviewBodyError = reviewBodyError;
const WRITERS = new Set(['ADMIN', 'MAINTAIN', 'WRITE']);
// A Map, not a record: a status from the wire must never hit an Object.prototype key.
const MERGE_HINTS = new Map([
    ['CLEAN', 'Ready to merge.'],
    ['HAS_HOOKS', 'Ready to merge.'],
    ['BEHIND', 'This branch is out of date with the base branch.'],
    ['BLOCKED', 'Merging is blocked: required reviews or checks are missing.'],
    ['UNSTABLE', 'Some checks have not passed.'],
    ['UNKNOWN', 'GitHub is still checking whether this can be merged.'],
]);
/** Only what is certain disables a button (see decision 30); BLOCKED / BEHIND / UNSTABLE are hints because admins and rulesets can bypass them. */
function pageActions(f) {
    const open = f.state === 'open';
    const methods = ['MERGE', 'SQUASH', 'REBASE'].filter(m => m === 'MERGE' ? f.mergeCommitAllowed : m === 'SQUASH' ? f.squashMergeAllowed : f.rebaseMergeAllowed);
    const canWrite = WRITERS.has(f.viewerPermission);
    let hint = '';
    if (open) {
        if (f.draft)
            hint = 'Mark this as ready for review to merge it.';
        else if (!canWrite)
            hint = 'Merging needs write access to this repository.';
        else if (methods.length === 0)
            hint = 'This repository allows no merge method.';
        else if (f.mergeable === 'CONFLICTING')
            hint = 'This branch has conflicts that must be resolved first.';
        else
            hint = MERGE_HINTS.get(f.mergeStateStatus) ?? '';
    }
    return {
        review: { available: open, canApprove: open && !f.viewerDidAuthor, pending: f.pendingComments },
        merge: { enabled: open && !f.draft && canWrite && methods.length > 0 && f.mergeable !== 'CONFLICTING', hint, methods },
        state: !f.viewerCanUpdate ? null : open ? 'close' : f.state === 'closed' ? 'reopen' : null,
        draft: !f.viewerCanUpdate || !open ? null : f.draft ? 'ready' : 'draft',
    };
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function reviewChoices(s) {
    const withPending = s.reviewId !== null && s.comments > 0 ? ` with your ${plural(s.comments, 'pending comment')}` : '';
    const options = [{ choice: 'COMMENT', label: 'Comment', description: `Send feedback without approving or blocking${withPending}` }];
    if (!s.viewerIsAuthor) {
        options.push({ choice: 'APPROVE', label: 'Approve', description: `Approve these changes${withPending}` }, { choice: 'REQUEST_CHANGES', label: 'Request changes', description: `Block merging until this is addressed${withPending}` });
    }
    if (s.reviewId !== null) {
        options.push({ choice: 'DISCARD', label: 'Discard pending review', description: `Delete your ${plural(s.comments, 'unsent comment')}` });
    }
    return options;
}
/** The InputBox's validation message, or undefined when `body` is acceptable for `event`. Catches what GitHub would only reject afterwards. */
function reviewBodyError(event, pendingComments, body) {
    if (body.trim())
        return undefined;
    if (event === 'REQUEST_CHANGES')
        return 'Say what needs to change.';
    if (event === 'COMMENT' && pendingComments === 0)
        return 'Write a comment, or add review comments in the diff first.';
    return undefined;
}
//# sourceMappingURL=pullActionsModel.js.map