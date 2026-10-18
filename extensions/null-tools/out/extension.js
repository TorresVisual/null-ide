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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const recentProjectsIntegration_1 = require("./recentProjectsIntegration");
const featuresTreeView_1 = require("./featuresTreeView");
const scratchNotesIntegration_1 = require("./scratchNotesIntegration");
const autoGitignore_1 = require("./autoGitignore");
const portsIntegration_1 = require("./portsIntegration");
const worktreesIntegration_1 = require("./worktreesIntegration");
const graphIntegration_1 = require("./graph/graphIntegration");
const discordPresenceIntegration_1 = require("./discordPresenceIntegration");
const issuesPanelIntegration_1 = require("./issuesPanelIntegration");
const pullsIntegration_1 = require("./pulls/pullsIntegration");
const commitMessage_1 = require("./commitMessage");
const updaterIntegration_1 = require("./updaterIntegration");
const commitValidationIntegration_1 = require("./commitValidationIntegration");
const nullNotes_1 = require("./nullNotes");
const welcomePage_1 = require("./welcomePage");
const dashboardIntegration_1 = require("./dashboardIntegration");
const claudeTabIntegration_1 = require("./claudeTabIntegration");
const followAlongIntegration_1 = require("./followAlongIntegration");
const whyIsThisHereIntegration_1 = require("./whyIsThisHereIntegration");
const recoveryIntegration_1 = require("./recovery/recoveryIntegration");
const firstRunIntegration_1 = require("./firstRunIntegration");
const setupIntegration_1 = require("./setupIntegration");
const dataDir_1 = require("./dataDir");
// ── Activation ─────────────────────────────────────────────────────────────
async function ensureWindowTitleFormat() {
    try {
        const config = vscode.workspace.getConfiguration('window');
        const expected = '${dirty}${rootName} - ${activeEditorShort}';
        if (config.get('title') !== expected) {
            await config.update('title', expected, vscode.ConfigurationTarget.Global);
        }
    }
    catch {
        // Ignore error
    }
}
function activate(context) {
    ensureWindowTitleFormat();
    const bar = vscode.window.createStatusBarItem('null.gen', vscode.StatusBarAlignment.Right, 0);
    bar.text = '$(sparkle)';
    bar.tooltip = 'Null: generate commit message';
    bar.command = 'null.generateCommitMessage';
    bar.show();
    context.subscriptions.push(bar);
    (0, dashboardIntegration_1.registerDashboardFeature)(context);
    (0, recentProjectsIntegration_1.registerRecentProjectsUriHandler)(context);
    (0, featuresTreeView_1.registerFeaturesView)(context);
    (0, scratchNotesIntegration_1.registerScratchAndNotesFeature)(context);
    (0, autoGitignore_1.registerAutoGitignoreFeature)(context);
    (0, updaterIntegration_1.registerUpdaterFeature)(context);
    (0, firstRunIntegration_1.registerFirstRunFeature)(context);
    (0, setupIntegration_1.registerSetupFeature)(context);
    (0, commitValidationIntegration_1.registerCommitValidationFeature)(context);
    context.subscriptions.push(vscode.commands.registerCommand('null.generateCommitMessage', async () => {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) {
            vscode.window.showErrorMessage('Open a folder first.');
            return;
        }
        const cwd = folders[0].uri.fsPath;
        const diff = (0, commitMessage_1.getStagedDiff)(cwd);
        if (!diff.trim()) {
            vscode.window.showWarningMessage('No changes found (nothing staged or committed).');
            return;
        }
        let message;
        if (!vscode.workspace.getConfiguration('null').get('commitMessage.useClaude', true)) {
            message = (0, commitMessage_1.heuristicMessage)((0, commitMessage_1.getChangedFiles)(cwd));
        }
        else
            try {
                await vscode.window.withProgress({ location: { viewId: 'workbench.scm' }, title: 'Generating commit message...' }, async () => { message = await (0, commitMessage_1.runClaude)(diff, cwd); });
            }
            catch (err) {
                message = (0, commitMessage_1.heuristicMessage)((0, commitMessage_1.getChangedFiles)(cwd));
                vscode.window.showWarningMessage(`Null: claude failed (${err.message.split('\n')[0]}). Inserted a basic message from the changed files — edit it before committing.`);
            }
        const gitExt = vscode.extensions.getExtension('vscode.git');
        if (!gitExt) {
            vscode.window.showErrorMessage('Built-in git extension not found.');
            return;
        }
        const git = gitExt.isActive ? gitExt.exports.getAPI(1) : (await gitExt.activate()).getAPI(1);
        const repo = git.repositories.find((r) => r.rootUri.fsPath === cwd) ?? git.repositories[0];
        if (repo && message) {
            repo.inputBox.value = message;
            vscode.commands.executeCommand('workbench.view.scm');
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.clearWebviewCache', async () => {
        let userDataDir;
        try {
            userDataDir = (0, dataDir_1.nullDataDir)();
        }
        catch (err) {
            vscode.window.showErrorMessage(`Null: ${err.message}`);
            return;
        }
        const targets = ['Cache', 'CachedData', 'Code Cache', 'WebStorage'];
        const cleared = [], failed = [];
        for (const name of targets) {
            const p = path.join(userDataDir, name);
            try {
                if (fs.existsSync(p))
                    fs.rmSync(p, { recursive: true, force: true });
                cleared.push(name);
            }
            catch {
                failed.push(name);
            }
        }
        const detail = cleared.length ? `Cleared: ${cleared.join(', ')}.` : 'Nothing to clear.';
        const warning = failed.length ? ` Could not delete: ${failed.join(', ')}.` : '';
        const choice = await vscode.window.showInformationMessage(`${detail}${warning} Reload window to apply.`, 'Reload Now');
        if (choice === 'Reload Now')
            vscode.commands.executeCommand('workbench.action.reloadWindow');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.showWelcome', () => (0, welcomePage_1.showWelcomePage)(context)));
    context.subscriptions.push(vscode.commands.registerCommand('null.openDashboard', dashboardIntegration_1.openDashboard));
    if (!context.globalState.get('null.welcomeShown')) {
        context.globalState.update('null.welcomeShown', true);
        (0, welcomePage_1.showWelcomePage)(context);
    }
    const plansDir = path.join(os.homedir(), '.claude', 'plans');
    const plansWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(plansDir), '*.md'), false, true, true);
    plansWatcher.onDidCreate((uri) => {
        setTimeout(() => {
            if (vscode.workspace.getConfiguration('null').get('plans.autoOpen', true)) {
                vscode.window.showTextDocument(uri);
            }
        }, 500);
    });
    context.subscriptions.push(plansWatcher);
    (0, portsIntegration_1.registerPortsFeature)(context);
    (0, worktreesIntegration_1.registerWorktreesFeature)(context);
    (0, graphIntegration_1.registerGraphFeature)(context);
    (0, issuesPanelIntegration_1.registerIssuesPanelFeature)(context);
    (0, pullsIntegration_1.registerPullsFeature)(context);
    (0, discordPresenceIntegration_1.registerDiscordPresenceFeature)(context);
    (0, nullNotes_1.registerOpenInNullNotesFeature)(context);
    (0, claudeTabIntegration_1.registerClaudeTabFeature)(context);
    (0, followAlongIntegration_1.registerFollowAlongFeature)(context);
    (0, whyIsThisHereIntegration_1.registerWhyIsThisHereFeature)(context);
    (0, recoveryIntegration_1.registerRecoveryFeature)(context);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map