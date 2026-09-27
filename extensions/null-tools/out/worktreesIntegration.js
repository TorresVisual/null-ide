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
exports.copySetupFiles = copySetupFiles;
exports.registerWorktreesFeature = registerWorktreesFeature;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const worktrees_1 = require("./worktrees");
const worktreesTreeView_1 = require("./worktreesTreeView");
function repoCwd() {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return folder ? (0, worktrees_1.resolveMainWorktreeRoot)(folder) : null;
}
function getCopyFilesGlob() {
    return vscode.workspace.getConfiguration('null.worktrees').get('copyFilesGlob', []);
}
async function copySetupFiles(sourceCwd, destCwd, globs) {
    for (const glob of globs) {
        const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file(sourceCwd), glob));
        for (const match of matches) {
            const rel = path.relative(sourceCwd, match.fsPath);
            const dest = path.join(destCwd, rel);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(match.fsPath, dest);
        }
    }
}
async function createAndOffer(cwd, opts, provider) {
    const result = (0, worktrees_1.createWorktree)(cwd, opts);
    if (!result.ok) {
        vscode.window.showErrorMessage(`Failed to create worktree: ${result.message}`);
        return;
    }
    const globs = getCopyFilesGlob();
    if (globs.length > 0)
        await copySetupFiles(cwd, result.value.path, globs);
    await provider.refresh();
    const choice = await vscode.window.showInformationMessage(`Worktree created on branch ${result.value.branch}.`, 'Open in New Window', 'Stay Here');
    if (choice === 'Open in New Window') {
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(result.value.path), { forceNewWindow: true });
    }
}
function registerWorktreesFeature(context) {
    const provider = new worktreesTreeView_1.WorktreeTreeProvider(repoCwd);
    context.subscriptions.push(vscode.window.registerTreeDataProvider('null.worktreesView', provider));
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => void provider.refresh()));
    context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.refresh', () => provider.refresh()));
    context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.new', async () => {
        const cwd = repoCwd();
        if (!cwd) {
            vscode.window.showErrorMessage('Open a folder first.');
            return;
        }
        const picked = await vscode.window.showQuickPick([
            { label: '$(issues) From Issue…', pickKind: 'issue' },
            { label: '$(git-branch) From Existing Branch…', pickKind: 'branch' },
            { label: '$(edit) From Scratch…', pickKind: 'scratch' },
        ], { placeHolder: 'New worktree…' });
        if (!picked)
            return;
        if (picked.pickKind === 'issue') {
            await vscode.commands.executeCommand('workbench.view.extension.null-issues');
            vscode.window.showInformationMessage('Pick an issue in the GitHub Issues panel, then use its "Create Worktree for Issue" button.');
            return;
        }
        let opts;
        if (picked.pickKind === 'branch') {
            const branches = (0, worktrees_1.listLocalBranches)(cwd);
            const branchPick = await vscode.window.showQuickPick(branches, { placeHolder: 'Pick a branch…' });
            if (!branchPick)
                return;
            opts = { kind: 'branch', branch: branchPick };
        }
        else {
            const description = await vscode.window.showInputBox({ prompt: 'Describe the work (used to name the branch)' });
            if (!description)
                return;
            opts = { kind: 'scratch', description };
        }
        await createAndOffer(cwd, opts, provider);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.createForIssue', async (issueNumber, title) => {
        const cwd = repoCwd();
        if (!cwd)
            return;
        await createAndOffer(cwd, { kind: 'issue', issueNumber, title }, provider);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.openInNewWindow', async (entry) => {
        if (!entry)
            return;
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(entry.path), { forceNewWindow: true });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.revealInExplorer', async (entry) => {
        if (!entry)
            return;
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(entry.path));
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.openTerminal', (entry) => {
        if (!entry)
            return;
        const terminal = vscode.window.createTerminal({ name: entry.branch ?? entry.path, cwd: entry.path });
        terminal.show();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.remove', async (entry) => {
        if (!entry)
            return;
        const cwd = repoCwd();
        if (!cwd)
            return;
        if (entry.isCurrent) {
            vscode.window.showErrorMessage('Cannot remove the worktree currently open in this window.');
            return;
        }
        const confirm = await vscode.window.showWarningMessage(`Remove worktree at ${entry.path}${entry.dirty ? ' (has uncommitted changes)' : ''}?`, { modal: true }, 'Remove');
        if (confirm !== 'Remove')
            return;
        const result = (0, worktrees_1.removeWorktree)(cwd, entry.path, entry.dirty);
        if (!result.ok)
            vscode.window.showErrorMessage(`Failed to remove worktree: ${result.message}`);
        await provider.refresh();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.mergeBack', async (entry) => {
        if (!entry)
            return;
        if (!entry.branch) {
            vscode.window.showErrorMessage('Cannot merge a detached-HEAD worktree — it has no branch.');
            return;
        }
        const cwd = repoCwd();
        if (!cwd)
            return;
        const baseBranch = (0, worktrees_1.getBaseBranch)(cwd);
        if (entry.branch === baseBranch) {
            vscode.window.showInformationMessage(`${entry.branch} is already the base branch.`);
            return;
        }
        let result = (0, worktrees_1.mergeWorktreeBack)(cwd, entry.branch, baseBranch, 'ff-only');
        if (!result.ok && result.reason === 'merge') {
            const retry = await vscode.window.showWarningMessage(`Fast-forward merge failed (${result.message}). Try a regular merge instead?`, 'Merge', 'Cancel');
            if (retry !== 'Merge')
                return;
            result = (0, worktrees_1.mergeWorktreeBack)(cwd, entry.branch, baseBranch, 'merge');
        }
        if (!result.ok) {
            vscode.window.showErrorMessage(`Merge failed: ${result.message}`);
            return;
        }
        await provider.refresh();
        const cleanup = await vscode.window.showWarningMessage(`Merged ${entry.branch} into ${baseBranch}. Remove the worktree and delete the branch?`, { modal: true }, 'Remove Worktree and Branch');
        if (cleanup === 'Remove Worktree and Branch') {
            const removeResult = (0, worktrees_1.removeWorktree)(cwd, entry.path, false);
            if (!removeResult.ok) {
                vscode.window.showErrorMessage(`Failed to remove worktree: ${removeResult.message}`);
                return;
            }
            try {
                (0, child_process_1.execFileSync)('git', ['branch', '-d', entry.branch], { cwd, encoding: 'utf8' });
            }
            catch (err) {
                vscode.window.showErrorMessage(`Worktree removed, but failed to delete branch ${entry.branch}: ${err.message}`);
            }
            await provider.refresh();
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.worktrees.prune', async () => {
        const cwd = repoCwd();
        if (!cwd)
            return;
        const baseBranch = (0, worktrees_1.getBaseBranch)(cwd);
        const { merged, missing } = await (0, worktrees_1.pruneCandidates)(cwd, baseBranch);
        if (merged.length === 0 && missing.length === 0) {
            vscode.window.showInformationMessage('Nothing to prune.');
            return;
        }
        const items = [
            ...missing.map(e => ({ label: `$(warning) ${e.path}`, description: 'directory missing', entry: e, pickKind: 'missing' })),
            ...merged.map(e => ({ label: `$(git-merge) ${e.branch}`, description: `merged into ${baseBranch}`, entry: e, pickKind: 'merged' })),
        ];
        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select worktrees to clean up…', canPickMany: true });
        if (!picked || picked.length === 0)
            return;
        const confirm = await vscode.window.showWarningMessage(`Clean up ${picked.length} worktree(s)?`, { modal: true }, 'Clean Up');
        if (confirm !== 'Clean Up')
            return;
        const errors = [];
        if (picked.some(item => item.pickKind === 'missing')) {
            const pruneResult = (0, worktrees_1.pruneWorktrees)(cwd);
            if (!pruneResult.ok)
                errors.push(`Prune failed: ${pruneResult.message}`);
        }
        for (const item of picked) {
            if (item.pickKind === 'merged') {
                const removeResult = (0, worktrees_1.removeWorktree)(cwd, item.entry.path, false);
                if (!removeResult.ok) {
                    errors.push(`Failed to remove ${item.entry.path}: ${removeResult.message}`);
                    continue;
                }
                if (item.entry.branch) {
                    try {
                        (0, child_process_1.execFileSync)('git', ['branch', '-d', item.entry.branch], { cwd, encoding: 'utf8' });
                    }
                    catch (err) {
                        errors.push(`Removed worktree, but failed to delete branch ${item.entry.branch}: ${err.message}`);
                    }
                }
            }
        }
        if (errors.length > 0)
            vscode.window.showErrorMessage(errors.join('\n'));
        await provider.refresh();
    }));
}
//# sourceMappingURL=worktreesIntegration.js.map