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
const child_process_1 = require("child_process");
const ollama = __importStar(require("./ollama"));
const recentProjectsIntegration_1 = require("./recentProjectsIntegration");
const scratchNotesIntegration_1 = require("./scratchNotesIntegration");
const autoGitignore_1 = require("./autoGitignore");
const portsIntegration_1 = require("./portsIntegration");
const discordPresenceIntegration_1 = require("./discordPresenceIntegration");
const agentsPanelIntegration_1 = require("./agentsPanelIntegration");
const issuesPanelIntegration_1 = require("./issuesPanelIntegration");
const soundManager_1 = require("./soundManager");
const codeActions_1 = require("./codeActions");
const commitMessage_1 = require("./commitMessage");
const updaterIntegration_1 = require("./updaterIntegration");
const nullNotes_1 = require("./nullNotes");
const welcomePage_1 = require("./welcomePage");
const dashboardIntegration_1 = require("./dashboardIntegration");
// ── Activation ─────────────────────────────────────────────────────────────
async function disableRestrictedMode() {
    try {
        const config = vscode.workspace.getConfiguration('security.workspace.trust');
        if (config.get('enabled') !== false) {
            await config.update('enabled', false, vscode.ConfigurationTarget.Global);
        }
        if (config.get('startupPrompt') !== 'never') {
            await config.update('startupPrompt', 'never', vscode.ConfigurationTarget.Global);
        }
        if (config.get('untrustedFiles') !== 'open') {
            await config.update('untrustedFiles', 'open', vscode.ConfigurationTarget.Global);
        }
        if (config.get('emptyWindow') !== false) {
            await config.update('emptyWindow', false, vscode.ConfigurationTarget.Global);
        }
    }
    catch {
        // Ignore error
    }
}
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
    disableRestrictedMode();
    ensureWindowTitleFormat();
    const bar = vscode.window.createStatusBarItem('null.gen', vscode.StatusBarAlignment.Right, 0);
    bar.text = '$(sparkle)';
    bar.tooltip = 'Null: generate commit message';
    bar.command = 'null.generateCommitMessage';
    bar.show();
    context.subscriptions.push(bar);
    (0, recentProjectsIntegration_1.registerRecentProjectsUriHandler)(context);
    (0, scratchNotesIntegration_1.registerScratchAndNotesFeature)(context);
    (0, autoGitignore_1.registerAutoGitignoreFeature)(context);
    (0, dashboardIntegration_1.registerDashboardFeature)(context);
    (0, updaterIntegration_1.registerUpdaterFeature)(context);
    const sounds = new soundManager_1.SoundManager();
    const soundBar = vscode.window.createStatusBarItem('null.sound', vscode.StatusBarAlignment.Right, -1);
    soundBar.text = '$(unmute)';
    soundBar.tooltip = 'Null: toggle sound design';
    soundBar.command = 'null.toggleSoundDesign';
    soundBar.show();
    context.subscriptions.push(soundBar);
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
        try {
            await vscode.window.withProgress({ location: { viewId: 'workbench.scm' }, title: 'Generating commit message...' }, async () => { message = await (0, commitMessage_1.runClaude)(diff, cwd); });
        }
        catch (err) {
            vscode.window.showErrorMessage(`Null: commit message generation failed — ${err.message}`);
            return;
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
        const appData = process.env.APPDATA;
        if (!appData) {
            vscode.window.showErrorMessage('Null: cannot locate %APPDATA%.');
            return;
        }
        const userDataDir = path.join(appData, 'Null');
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
    if (!context.globalState.get('null.welcomeShown')) {
        context.globalState.update('null.welcomeShown', true);
        (0, welcomePage_1.showWelcomePage)(context);
    }
    const agentsProvider = (0, agentsPanelIntegration_1.registerAgentsPanelFeature)(context);
    // ── Ollama status bar ──────────────────────────────────────────────────────
    const ollamaBar = vscode.window.createStatusBarItem('null.ollama', vscode.StatusBarAlignment.Right, -2);
    ollamaBar.text = `∅ ${vscode.workspace.getConfiguration('null.ollama').get('model', 'llama3.2')}`;
    ollamaBar.tooltip = 'Null: Switch Ollama model';
    ollamaBar.command = 'null.ollamaModel';
    ollamaBar.show();
    context.subscriptions.push(ollamaBar);
    context.subscriptions.push(vscode.commands.registerCommand('null.ollamaModel', async () => {
        const alive = await ollama.isAlive();
        if (!alive) {
            vscode.window.showErrorMessage('Ollama is not running. Start it with: ollama serve');
            return;
        }
        const available = await ollama.models();
        if (!available.length) {
            vscode.window.showWarningMessage('No Ollama models installed. Run: ollama pull llama3.2');
            return;
        }
        const current = vscode.workspace.getConfiguration('null.ollama').get('model', 'llama3.2');
        const picked = await vscode.window.showQuickPick(available.map(m => ({ label: m, description: m === current ? '(current)' : undefined })), { placeHolder: 'Select Ollama model' });
        if (!picked)
            return;
        await vscode.workspace.getConfiguration('null.ollama').update('model', picked.label, true);
        ollamaBar.text = `∅ ${picked.label}`;
        vscode.window.setStatusBarMessage(`Ollama model → ${picked.label}`, 2000);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.ollamaChat', async () => {
        const question = await vscode.window.showInputBox({ prompt: 'Ask Ollama', placeHolder: 'What would you like to know?' });
        if (!question)
            return;
        const editor = vscode.window.activeTextEditor;
        let ctx = '';
        if (editor) {
            const sel = editor.selection;
            const text = !sel.isEmpty ? editor.document.getText(sel) : editor.document.getText().slice(0, 32768);
            ctx = `\n\n--- context: ${vscode.workspace.asRelativePath(editor.document.uri)} (${editor.document.languageId}) ---\n${text}\n---`;
        }
        const termId = agentsProvider.getOrCreateOllamaTab();
        agentsProvider.writeToTerm(termId, question + ctx + '\r');
        vscode.commands.executeCommand('workbench.view.extension.null-agents');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.ollamaReview', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('Open a file to review.');
            return;
        }
        const file = vscode.workspace.asRelativePath(editor.document.uri);
        const lang = editor.document.languageId;
        const code = editor.document.getText().slice(0, 32768);
        const wsFolders = vscode.workspace.workspaceFolders;
        let diff = '';
        if (wsFolders?.length) {
            try {
                diff = (0, child_process_1.execSync)('git diff HEAD', { cwd: wsFolders[0].uri.fsPath, encoding: 'utf8', timeout: 5000 }).slice(0, 2048);
            }
            catch { }
        }
        const prompt = `Review this ${lang} file (${file}) for bugs, security issues, and improvements:\n\n` +
            `\`\`\`${lang}\n${code}\n\`\`\`` +
            (diff ? `\n\nRecent changes (git diff HEAD):\n\`\`\`diff\n${diff}\n\`\`\`` : '') + '\r';
        const termId = agentsProvider.getOrCreateOllamaTab();
        agentsProvider.writeToTerm(termId, prompt);
        vscode.commands.executeCommand('workbench.view.extension.null-agents');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.insertPromptTemplate', async () => {
        const templates = vscode.workspace.getConfiguration('null')
            .get('promptTemplates', []);
        if (!templates.length) {
            vscode.window.showWarningMessage('No prompt templates configured. Add them in Settings → null.promptTemplates.');
            return;
        }
        const picked = await vscode.window.showQuickPick(templates.map(t => ({ label: t.label, description: t.text.slice(0, 60).replace(/\n/g, '↵'), _text: t.text })), { placeHolder: 'Select a prompt template' });
        if (!picked)
            return;
        if (!agentsProvider.writeToActive(picked._text)) {
            vscode.window.showWarningMessage('No active agent terminal. Open an agent tab first.');
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.injectContext', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('Open a file first.');
            return;
        }
        const file = vscode.workspace.asRelativePath(editor.document.uri);
        const lang = editor.document.languageId;
        const sel = editor.selection;
        const maxBytes = agentsProvider.activeTabType() === 'ollama' ? 32768 : 8192;
        const text = !sel.isEmpty ? editor.document.getText(sel) : editor.document.getText().slice(0, maxBytes);
        const wsFolders = vscode.workspace.workspaceFolders;
        let diff = '';
        if (wsFolders?.length) {
            try {
                diff = (0, child_process_1.execSync)('git diff --staged', { cwd: wsFolders[0].uri.fsPath, encoding: 'utf8', timeout: 5000 }).slice(0, 2048);
            }
            catch { }
        }
        const block = `--- context: ${file} (${lang}) ---\n${text}\n---` +
            (diff ? `\n\n--- staged changes ---\n${diff}\n---` : '') + '\n';
        if (!agentsProvider.writeToActive(block)) {
            vscode.window.showWarningMessage('No active agent terminal. Open an agent tab first.');
        }
        else {
            vscode.commands.executeCommand('workbench.view.extension.null-agents');
        }
    }));
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider({ pattern: '**' }, new codeActions_1.NullCodeActionsProvider(agentsProvider), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));
    context.subscriptions.push(vscode.commands.registerCommand('null._fixWithAI', (document, diag) => {
        const file = vscode.workspace.asRelativePath(document.uri);
        const lang = document.languageId;
        const line = diag.range.start.line;
        const start = Math.max(0, line - 10);
        const end = Math.min(document.lineCount - 1, line + 10);
        const snippet = document.getText(new vscode.Range(start, 0, end, document.lineAt(end).text.length));
        const block = `--- fix with AI: ${file}:${line + 1} (${lang}) ---\n` +
            `Error: ${diag.message}\n\n` +
            `Code (lines ${start + 1}–${end + 1}):\n${snippet}\n---\n`;
        if (!agentsProvider.writeToActive(block)) {
            vscode.window.showWarningMessage('No active agent terminal. Open an agent tab first.');
        }
        else {
            vscode.commands.executeCommand('workbench.view.extension.null-agents');
        }
    }));
    sounds.attach(agentsProvider);
    context.subscriptions.push(vscode.commands.registerCommand('null.toggleSoundDesign', () => {
        const on = sounds.toggle();
        soundBar.text = on ? '$(unmute)' : '$(mute)';
        vscode.window.setStatusBarMessage(`Sound design ${on ? 'on' : 'off'}`, 2000);
    }));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(() => sounds.post('save')));
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(() => sounds.post('open')));
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
    (0, issuesPanelIntegration_1.registerIssuesPanelFeature)(context);
    (0, discordPresenceIntegration_1.registerDiscordPresenceFeature)(context);
    (0, nullNotes_1.registerOpenInNullNotesFeature)(context);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map