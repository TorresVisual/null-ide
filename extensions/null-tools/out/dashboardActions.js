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
exports.createProjectDirectory = createProjectDirectory;
exports.runNewProjectFlow = runNewProjectFlow;
exports.runCloneRepoFlow = runCloneRepoFlow;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
function createProjectDirectory(target) {
    try {
        fs.mkdirSync(target);
        (0, child_process_1.execFileSync)('git', ['init'], { cwd: target, timeout: 5000 });
        return { ok: true };
    }
    catch (err) {
        return { ok: false, message: err.message };
    }
}
async function runNewProjectFlow() {
    // Lazy require: keeps this module loadable under plain `node --test` (no
    // `vscode` module outside the Extension Host) so createProjectDirectory
    // stays covered by real unit tests.
    const vscode = require('vscode');
    const parent = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Choose Parent Folder',
    });
    if (!parent || parent.length === 0)
        return;
    const name = await vscode.window.showInputBox({
        prompt: 'Project name',
        validateInput: value => (value.trim().length === 0 ? 'Enter a project name.' : undefined),
    });
    if (!name)
        return;
    const target = path.join(parent[0].fsPath, name.trim());
    const result = createProjectDirectory(target);
    if (!result.ok) {
        vscode.window.showErrorMessage(`Null: failed to create project — ${result.message}`);
        return;
    }
    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target));
}
let cloneTerminal;
function getCloneTerminal(vscode) {
    if (!cloneTerminal || cloneTerminal.exitStatus !== undefined) {
        cloneTerminal = vscode.window.createTerminal({ name: 'Null: Clone Repo' });
    }
    return cloneTerminal;
}
async function runCloneRepoFlow(context) {
    const vscode = require('vscode');
    const url = await vscode.window.showInputBox({
        prompt: 'Repository URL to clone',
        validateInput: value => (value.trim().length === 0 ? 'Enter a repository URL.' : undefined),
    });
    if (!url)
        return;
    const parent = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Choose Parent Folder',
    });
    if (!parent || parent.length === 0)
        return;
    const trimmedUrl = url.trim();
    const folderName = path.basename(trimmedUrl, '.git');
    const target = vscode.Uri.file(path.join(parent[0].fsPath, folderName));
    const terminal = getCloneTerminal(vscode);
    terminal.show();
    if (terminal.shellIntegration) {
        // Args passed out-of-band (not interpolated into a shell string), so a
        // clone URL containing shell metacharacters (", $(...), backticks, etc.)
        // can't break out and execute arbitrary commands.
        const execution = terminal.shellIntegration.executeCommand('git', ['clone', trimmedUrl, target.fsPath]);
        const subscription = vscode.window.onDidEndTerminalShellExecution(event => {
            if (event.execution !== execution)
                return;
            subscription.dispose();
            if (event.exitCode === 0) {
                vscode.commands.executeCommand('vscode.openFolder', target);
            }
        });
        context.subscriptions.push(subscription);
    }
    else {
        // No Shell Integration active (unusual shell, or the setting disabled):
        // sendText goes straight to the shell as text, so there's no exit-code
        // signal and no out-of-band args -- the clone still runs, it just can't
        // auto-open the folder on completion. Accepted degradation per the
        // design spec, not a bug.
        // ponytail: single-quote escaping is safe for POSIX shells and
        // PowerShell (both treat '...' as fully literal) but not cmd.exe, which
        // isn't VS Code's default integrated shell on Windows. Upgrade path if
        // that changes: detect terminal.shellPath and branch the escaping.
        const singleQuote = (s) => `'${s.replace(/'/g, "''")}'`;
        terminal.sendText(`git clone ${singleQuote(trimmedUrl)} ${singleQuote(target.fsPath)}`);
    }
}
//# sourceMappingURL=dashboardActions.js.map