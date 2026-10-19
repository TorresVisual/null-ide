'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAGE_ACTIONS = void 0;
exports.finishReview = finishReview;
exports.runAction = runAction;
const vscode = __importStar(require("vscode"));
const githubAuth_1 = require("../github/githubAuth");
const pullActionsModel_1 = require("./pullActionsModel");
const pullLifecycleApi_1 = require("./pullLifecycleApi");
const pullModel_1 = require("./pullModel");
const pullReviewApi_1 = require("./pullReviewApi");
/** What the panel accepts from the webview; anything else is ignored. */
exports.PAGE_ACTIONS = new Set(['review', 'merge', 'close', 'reopen', 'ready', 'draft']);
const METHOD_LABELS = {
    MERGE: 'Create a merge commit', SQUASH: 'Squash and merge', REBASE: 'Rebase and merge',
};
async function token() {
    return (await (0, githubAuth_1.getGithubSession)(true))?.accessToken ?? null;
}
function fail(what, err) {
    void vscode.window.showErrorMessage(`Could not ${what}: ${(0, pullModel_1.describeFailure)(err)}`);
    return 'failed';
}
/** Ends the viewer's review: comment / approve / request changes (submitting any pending comments with it), or discard it. */
async function finishReview(target) {
    const t = await token();
    if (!t)
        return 'cancelled';
    let state;
    try {
        state = await (0, pullReviewApi_1.fetchReviewState)(target.owner, target.repo, target.number, t);
    }
    catch (err) {
        return fail(`load the review of #${target.number}`, err);
    }
    const picked = await vscode.window.showQuickPick((0, pullActionsModel_1.reviewChoices)(state).map(o => ({ label: o.label, description: o.description, choice: o.choice })), { title: `Review #${target.number}`, placeHolder: 'How do you want to finish your review?' });
    if (!picked)
        return 'cancelled';
    const choice = picked.choice;
    try {
        if (choice === 'DISCARD') {
            const sure = await vscode.window.showWarningMessage(`Discard your ${state.comments} unsent comment${state.comments === 1 ? '' : 's'} on #${target.number}?`, { modal: true }, 'Discard');
            if (!sure || state.reviewId === null)
                return 'cancelled';
            await (0, pullReviewApi_1.discardReview)(state.reviewId, t);
            void vscode.window.showInformationMessage('Pending review discarded.');
            return 'changed';
        }
        const event = choice;
        const body = await vscode.window.showInputBox({
            title: `${picked.label} · #${target.number}`,
            prompt: event === 'APPROVE' ? 'Optional summary' : 'Summary',
            validateInput: v => (0, pullActionsModel_1.reviewBodyError)(event, state.comments, v),
        });
        if (body === undefined)
            return 'cancelled';
        if (state.reviewId === null)
            await (0, pullReviewApi_1.submitNewReview)(state, event, body.trim(), t);
        else
            await (0, pullReviewApi_1.submitReview)(state.reviewId, event, body.trim(), t);
        void vscode.window.showInformationMessage(`Review submitted on #${target.number}.`);
        return 'changed';
    }
    catch (err) {
        return fail(`submit the review of #${target.number}`, err);
    }
}
async function merge(page) {
    const methods = page.actions.merge.methods;
    const method = methods.length === 1 ? methods[0]
        : (await vscode.window.showQuickPick(methods.map(m => ({ label: METHOD_LABELS[m], method: m })), { title: `Merge #${page.number}`, placeHolder: 'How should it be merged?' }))?.method;
    if (!method)
        return 'cancelled';
    const sure = await vscode.window.showWarningMessage(`${METHOD_LABELS[method]}: #${page.number} into ${page.baseRef}?`, { modal: true, detail: page.title }, 'Merge');
    if (!sure)
        return 'cancelled';
    const t = await token();
    if (!t)
        return 'cancelled';
    try {
        await (0, pullLifecycleApi_1.mergePull)(page.id, method, page.headSha, t); // pinned to the head this page showed
        void vscode.window.showInformationMessage(`Merged #${page.number} into ${page.baseRef}.`);
        return 'changed';
    }
    catch (err) {
        return fail(`merge #${page.number}`, err);
    }
}
/** Close / reopen / draft: reversible, so no confirmation. */
async function changeState(action, page) {
    const t = await token();
    if (!t)
        return 'cancelled';
    try {
        if (action === 'close' || action === 'reopen')
            await (0, pullLifecycleApi_1.setPullOpen)(page.id, action === 'reopen', t);
        else
            await (0, pullLifecycleApi_1.setPullDraft)(page.id, action === 'draft', t);
        return 'changed';
    }
    catch (err) {
        const what = { close: 'close', reopen: 'reopen', ready: 'mark as ready', draft: 'convert to a draft' }[action];
        return fail(`${what} #${page.number}`, err);
    }
}
/** Runs one tab action. The host trusts its own loaded `page.actions`, never the webview: an action the page did not offer does nothing. */
async function runAction(action, target, page) {
    const a = page.actions;
    switch (action) {
        case 'review': return a.review.available ? finishReview(target) : 'cancelled';
        case 'merge': return a.merge.enabled ? merge(page) : 'cancelled';
        case 'close':
        case 'reopen': return a.state === action ? changeState(action, page) : 'cancelled';
        case 'ready':
        case 'draft': return a.draft === action ? changeState(action, page) : 'cancelled';
    }
}
//# sourceMappingURL=pullActions.js.map