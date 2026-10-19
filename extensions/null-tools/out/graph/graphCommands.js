/// <reference path="./protocol.ts" />
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
exports.registerGraphCommands = registerGraphCommands;
const vscode = __importStar(require("vscode"));
const gitActions_1 = require("./gitActions");
const graphMessages_1 = require("./graphMessages");
function report(result) {
    if (!result.ok)
        void vscode.window.showErrorMessage(`Commit Graph: ${result.message}`);
    return result.ok;
}
/** A stopped cherry-pick/revert/merge/rebase is not an error: say what to do and offer the next step. */
async function reportOperation(result, label) {
    if (!report(result) || !result.ok || !result.value.stopped)
        return;
    const firstLine = result.value.message.split('\n').find((l) => l.trim()) ?? '';
    const choice = await vscode.window.showWarningMessage(`${label} stopped: ${firstLine} Resolve conflicts in the merge editor, then continue.`, 'Continue', 'Skip', 'Abort');
    if (choice)
        await vscode.commands.executeCommand(`null.graph.${choice.toLowerCase()}`);
}
/** For a merge commit: which parent to replay against. 0 = not a merge, null = cancelled. */
async function pickMergeParent(service, sha, verb) {
    const detail = await service.commitDetail(sha);
    if (detail.parents.length < 2)
        return 0;
    const picked = await vscode.window.showQuickPick(detail.parents.map((parent, i) => ({ label: `Parent ${i + 1}`, description: parent.slice(0, 7), number: i + 1 })), { placeHolder: `${sha.slice(0, 7)} is a merge commit. ${verb} relative to which parent?` });
    return picked ? picked.number : null;
}
async function checkoutFlow(session, sha) {
    const availability = await session.availability();
    if (!availability.ok)
        return;
    const refs = (await availability.service.refs()).filter((r) => r.sha === sha);
    const items = [
        ...refs.filter((r) => r.kind === 'branch').map((r) => ({ label: r.name, description: 'branch', target: { kind: 'branch', name: r.name } })),
        ...refs.filter((r) => r.kind === 'remote').map((r) => ({ label: r.name, description: 'remote branch — creates a tracking branch', target: { kind: 'remote', name: r.name } })),
        ...refs.filter((r) => r.kind === 'tag').map((r) => ({ label: r.name, description: 'tag — detached HEAD', target: { kind: 'detach', sha } })),
    ];
    let target;
    if (items.length === 1 && items[0].target.kind !== 'detach') {
        target = items[0].target;
    }
    else {
        items.push({ label: `Detached HEAD at ${sha.slice(0, 7)}`, target: { kind: 'detach', sha } });
        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Check out…' });
        if (!picked)
            return;
        target = picked.target;
    }
    if (target.kind === 'detach') {
        const choice = await vscode.window.showWarningMessage('This detaches HEAD: commits made here belong to no branch until you create one.', 'Detach HEAD');
        if (choice !== 'Detach HEAD')
            return;
    }
    report(await session.runAction((a) => (0, gitActions_1.checkout)(a.act, target)));
}
async function createBranchFlow(session, sha) {
    const name = await vscode.window.showInputBox({
        prompt: `New branch at ${sha.slice(0, 7)}`,
        validateInput: (value) => (!value || value.startsWith('-') || /\s/.test(value) ? 'Enter a valid branch name (no spaces)' : undefined),
    });
    if (name)
        report(await session.runAction((a) => (0, gitActions_1.createBranch)(a.act, name, sha)));
}
async function replayFlow(session, sha, kind) {
    const availability = await session.availability();
    if (!availability.ok)
        return;
    const parent = await pickMergeParent(availability.service, sha, kind === 'revert' ? 'Revert' : 'Cherry-pick');
    if (parent === null)
        return;
    const result = await session.runAction((a) => {
        const inProgress = () => a.service.inProgress();
        const number = parent || undefined;
        return kind === 'revert' ? (0, gitActions_1.revert)(a.act, inProgress, sha, number) : (0, gitActions_1.cherryPick)(a.act, inProgress, sha, number);
    });
    await reportOperation(result, kind === 'revert' ? 'Revert' : 'Cherry-pick');
}
async function resetFlow(session, sha, mode) {
    const availability = await session.availability();
    if (!availability.ok)
        return;
    const impact = await (0, gitActions_1.resetImpact)(availability.read, sha);
    if (!report(impact) || !impact.ok)
        return;
    const { branch, leaving, orphaned, trackedChanges } = impact.value;
    const where = branch ?? 'the detached HEAD';
    const lines = [leaving === 0 ? `No commits leave ${where}.` : `${leaving} commit${leaving === 1 ? '' : 's'} will no longer be on ${where}.`];
    if (orphaned > 0) {
        lines.push(`${orphaned} of them ${orphaned === 1 ? 'is' : 'are'} on no other branch or tag${mode === 'hard' ? ' and can only be recovered through the reflog afterwards' : ''}.`);
    }
    if (mode === 'soft')
        lines.push('Changes stay staged.');
    if (mode === 'mixed')
        lines.push('Changes stay in your working tree, unstaged.');
    const button = `Reset (${mode})`;
    const choice = await vscode.window.showWarningMessage(`Reset ${where} (${mode}) to ${sha.slice(0, 7)}?`, { modal: true, detail: lines.join('\n') }, button);
    if (choice !== button)
        return;
    if (mode === 'hard' && trackedChanges > 0) {
        const discard = 'Discard changes and reset';
        const again = await vscode.window.showWarningMessage(`${trackedChanges} modified file${trackedChanges === 1 ? '' : 's'} will be overwritten and lost.`, { modal: true, detail: 'A hard reset replaces the working tree with the target commit.' }, discard);
        if (again !== discard)
            return;
    }
    report(await session.runAction((a) => (0, gitActions_1.reset)(a.act, mode, sha)));
}
/** One line per outcome. A refused pull is named, never silent. */
function pullMessage(outcome) {
    switch (outcome.kind) {
        case 'upToDate':
            void vscode.window.showInformationMessage('Already up to date.');
            return;
        case 'fastForwarded':
            void vscode.window.showInformationMessage(`Pulled ${outcome.commits} ${outcome.commits === 1 ? 'commit' : 'commits'}.`);
            return;
        case 'noUpstream':
            void vscode.window.showWarningMessage('This branch has no upstream to pull from.');
            return;
    }
}
const commits = (n, adjective) => `${n} ${adjective} ${n === 1 ? 'commit' : 'commits'}`;
/** The modal for a user whose git config does not say. `remember` saves the answer; a dismissed prompt returns null and changes nothing. */
async function askStrategy(ahead, behind) {
    const choice = await vscode.window.showWarningMessage(`This branch has diverged from its upstream: ${commits(ahead, 'local')}, ${commits(behind, 'incoming')}.`, {
        modal: true,
        detail: 'Rebase puts your local commits on top of the incoming ones and keeps history linear; your local commits get new hashes. '
            + 'Merge keeps every commit as it is and adds a merge commit. Either can stop on conflicts: the Commit Graph then offers Continue, Skip and Abort. '
            + 'Always Rebase and Always Merge save the answer as pull.rebase in this repository\'s git config, so you are not asked again.',
    }, 'Rebase', 'Merge', 'Always Rebase', 'Always Merge');
    switch (choice) {
        case 'Rebase': return { strategy: 'rebase', remember: false };
        case 'Merge': return { strategy: 'merge', remember: false };
        case 'Always Rebase': return { strategy: 'rebase', remember: true };
        case 'Always Merge': return { strategy: 'merge', remember: true };
        default: return null;
    }
}
/** Pull never merges or rebases unprompted unless the user's git config (pull.rebase, branch.<name>.rebase, pull.ff) already says to. */
async function divergedFlow(session, ahead, behind) {
    const availability = await session.availability();
    if (!availability.ok)
        return;
    const preference = await (0, gitActions_1.pullPreference)(availability.read);
    if (preference === 'ff-only') {
        void vscode.window.showWarningMessage(`This branch has diverged from its upstream (${commits(ahead, 'local')}, ${commits(behind, 'incoming')}) and pull.ff is "only", so nothing was pulled. Rebase or merge it yourself, or change pull.ff.`);
        return;
    }
    let strategy;
    if (preference === 'ask') {
        const answer = await askStrategy(ahead, behind);
        if (!answer)
            return;
        strategy = answer.strategy;
        // Saved before the operation: a stopped rebase blocks further actions until it is resolved, and the answer is already given.
        if (answer.remember)
            report(await (0, gitActions_1.rememberPullStrategy)(availability.act, strategy));
    }
    else {
        strategy = preference;
    }
    const label = (0, gitActions_1.integrateLabel)(strategy);
    const result = await session.runAction((a) => (0, gitActions_1.integrateUpstream)(a.act, () => a.service.inProgress(), strategy));
    await reportOperation(result, label);
    if (result.ok && !result.value.stopped) {
        void vscode.window.showInformationMessage((0, gitActions_1.integrateDoneText)(strategy));
    }
}
async function pullFlow(session) {
    const result = await session.runAction((a) => (0, gitActions_1.pull)(a.act));
    if (!result.ok) {
        report(result);
        return;
    }
    const outcome = result.value;
    if (outcome.kind === 'diverged') {
        await divergedFlow(session, outcome.ahead, outcome.behind);
        return;
    }
    pullMessage(outcome);
}
function registerGraphCommands(context, session, panel) {
    const register = (id, handler) => context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    const withSha = (fn) => async (arg) => {
        const sha = (0, graphMessages_1.shaFromArg)(arg);
        if (sha)
            await fn(sha);
    };
    register('null.graph.open', (arg) => panel.reveal((0, graphMessages_1.shaFromArg)(arg)));
    register('null.graph.refresh', () => session.invalidate());
    register('null.graph.copySha', withSha(async (sha) => { await vscode.env.clipboard.writeText(sha); }));
    register('null.graph.checkout', withSha((sha) => checkoutFlow(session, sha)));
    register('null.graph.pull', () => pullFlow(session));
    register('null.graph.createBranch', withSha((sha) => createBranchFlow(session, sha)));
    register('null.graph.cherryPick', withSha((sha) => replayFlow(session, sha, 'cherry-pick')));
    register('null.graph.revert', withSha((sha) => replayFlow(session, sha, 'revert')));
    for (const mode of ['soft', 'mixed', 'hard']) {
        register(`null.graph.reset.${mode}`, withSha((sha) => resetFlow(session, sha, mode)));
    }
    for (const action of ['continue', 'skip', 'abort']) {
        register(`null.graph.${action}`, async () => {
            const result = await session.runAction((a) => (0, gitActions_1.resumeOperation)(a.act, () => a.service.inProgress(), action), { duringOperation: true });
            await reportOperation(result, 'Operation');
        });
    }
    // Internal seams for the integration spec; they run the same code paths as the webview.
    register('_null.graph.snapshot', () => panel.snapshot());
    register('_null.graph.dispatch', (raw) => panel.handleRaw(raw));
}
//# sourceMappingURL=graphCommands.js.map