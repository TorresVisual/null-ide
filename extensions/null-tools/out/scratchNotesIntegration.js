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
exports.registerScratchAndNotesFeature = registerScratchAndNotesFeature;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const scratchNotesStorage_1 = require("./scratchNotesStorage");
const scratchNotesTreeView_1 = require("./scratchNotesTreeView");
const output = vscode.window.createOutputChannel('Null Scratch & Notes');
function getWorkspaceRoot() {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
function tryEnsureGitignoreEntry(root) {
    try {
        (0, scratchNotesStorage_1.ensureGitignoreEntry)(root);
    }
    catch (err) {
        output.appendLine(`Could not update .gitignore: ${err.message}`);
    }
}
function readFileSafe(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    }
    catch {
        return '';
    }
}
async function renameItem(filePath) {
    const dir = path.dirname(filePath);
    const oldName = path.basename(filePath);
    const newName = await vscode.window.showInputBox({ prompt: 'New file name', value: oldName });
    if (!newName || newName === oldName) {
        return;
    }
    fs.renameSync(filePath, path.join(dir, newName));
}
async function deleteItem(filePath) {
    const confirmed = await vscode.window.showWarningMessage(`Delete "${path.basename(filePath)}"?`, { modal: true }, 'Delete');
    if (confirmed !== 'Delete') {
        return;
    }
    fs.unlinkSync(filePath);
}
function registerScratchAndNotesFeature(context) {
    const workspaceRoot = getWorkspaceRoot();
    const scratchProvider = new scratchNotesTreeView_1.FolderTreeProvider(workspaceRoot ? (0, scratchNotesStorage_1.getScratchDir)(workspaceRoot) : undefined, filePath => path.basename(filePath));
    const notesProvider = new scratchNotesTreeView_1.FolderTreeProvider(workspaceRoot ? (0, scratchNotesStorage_1.getNotesDir)(workspaceRoot) : undefined, filePath => (0, scratchNotesStorage_1.deriveNoteLabel)(filePath, readFileSafe(filePath)));
    context.subscriptions.push(vscode.window.registerTreeDataProvider('null.scratchView', scratchProvider), vscode.window.registerTreeDataProvider('null.notesView', notesProvider), scratchProvider.watch(), notesProvider.watch());
    context.subscriptions.push(vscode.commands.registerCommand('null.newScratchFile', async () => {
        const root = getWorkspaceRoot();
        if (!root) {
            vscode.window.showErrorMessage('Open a folder to create scratch files.');
            return;
        }
        const picked = await vscode.window.showQuickPick(scratchNotesStorage_1.SCRATCH_LANGUAGES.map(lang => ({ label: lang.label, lang })), { placeHolder: 'Select a language for the new scratch file' });
        if (!picked) {
            return;
        }
        const scratchDir = (0, scratchNotesStorage_1.getScratchDir)(root);
        let filePath;
        try {
            (0, scratchNotesStorage_1.ensureDir)(scratchDir);
            filePath = path.join(scratchDir, (0, scratchNotesStorage_1.buildScratchFilename)(picked.lang.extension));
            fs.writeFileSync(filePath, '');
        }
        catch (err) {
            vscode.window.showErrorMessage(`Could not create scratch file: ${err.message}`);
            return;
        }
        tryEnsureGitignoreEntry(root);
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.newNote', async () => {
        const root = getWorkspaceRoot();
        if (!root) {
            vscode.window.showErrorMessage('Open a folder to create notes.');
            return;
        }
        const title = await vscode.window.showInputBox({ prompt: 'Note title' });
        if (!title) {
            return;
        }
        const notesDir = (0, scratchNotesStorage_1.getNotesDir)(root);
        let filePath;
        try {
            (0, scratchNotesStorage_1.ensureDir)(notesDir);
            const existing = fs.readdirSync(notesDir);
            filePath = path.join(notesDir, (0, scratchNotesStorage_1.buildNoteFilename)(title, existing));
            fs.writeFileSync(filePath, `# ${title}\n\n`);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Could not create note: ${err.message}`);
            return;
        }
        tryEnsureGitignoreEntry(root);
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.renameScratchOrNoteItem', renameItem), vscode.commands.registerCommand('null.deleteScratchOrNoteItem', deleteItem), output);
}
//# sourceMappingURL=scratchNotesIntegration.js.map