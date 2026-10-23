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
exports.runButton = runButton;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const variableResolver_1 = require("./variableResolver");
const workspaceFolder_1 = require("./workspaceFolder");
function buildVariableContext() {
    const editor = vscode.window.activeTextEditor;
    const doc = editor?.document;
    const folder = (0, workspaceFolder_1.activeWorkspaceFolder)();
    const fsPath = doc?.uri.fsPath;
    return {
        workspaceFolder: folder?.uri.fsPath,
        file: fsPath,
        fileBasename: fsPath ? path.basename(fsPath) : undefined,
        fileDirname: fsPath ? path.dirname(fsPath) : undefined,
        relativeFile: doc ? vscode.workspace.asRelativePath(doc.uri) : undefined,
        selectedText: editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : undefined,
        lineNumber: editor ? String(editor.selection.active.line + 1) : undefined,
        env: process.env,
    };
}
async function runButton(button, registry) {
    if (button.saveAll) {
        await vscode.workspace.saveAll();
    }
    const ctx = buildVariableContext();
    // Running with a literal "${file}" in the command is never what the user meant.
    const missing = [];
    const resolve = (text) => (0, variableResolver_1.resolveVariables)(text, ctx, missing);
    const refuseIfUnresolved = () => {
        if (missing.length === 0) {
            return false;
        }
        void vscode.window.showWarningMessage(`"${button.label}" was not run: ${[...new Set(missing)].join(', ')} could not be resolved (open a file, folder or selection first).`);
        return true;
    };
    if (button.type === 'vscode-command') {
        const args = (button.args ?? []).map(a => (typeof a === 'string' ? resolve(a) : a));
        if (refuseIfUnresolved()) {
            return;
        }
        await vscode.commands.executeCommand(button.command, ...args);
        return;
    }
    const cwd = button.cwd ? resolve(button.cwd) : ctx.workspaceFolder;
    const command = resolve(button.command);
    if (refuseIfUnresolved()) {
        return;
    }
    const run = () => registry.dispatch(button.id, button.label, command, { cwd, focus: button.focus, problemMatcher: button.problemMatcher });
    if (!registry.isBusy(button.id)) {
        await run();
        return;
    }
    // Still running: typing the command again would feed the live process's stdin.
    const choice = button.onBusy === 'ask' ? await askWhatToDo(button.label) : button.onBusy;
    if (choice === 'restart') {
        await registry.interrupt(button.id);
        await run();
    }
    else if (choice === 'show') {
        registry.show(button.id);
    }
    else if (choice === 'run') {
        await run();
    }
}
async function askWhatToDo(label) {
    const picked = await vscode.window.showQuickPick([
        { label: '$(debug-restart) Restart', detail: 'Stop it with Ctrl+C, then run it again', value: 'restart' },
        { label: '$(terminal) Show terminal', detail: 'Leave it running and look at its output', value: 'show' },
        { label: '$(warning) Run anyway', detail: 'Type the command into the running process', value: 'run' },
    ], { title: `"${label}" is still running` });
    return picked?.value;
}
//# sourceMappingURL=runButton.js.map