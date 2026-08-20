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
const vscode = __importStar(require("vscode"));
const variableResolver_1 = require("./variableResolver");
function buildVariableContext() {
    const editor = vscode.window.activeTextEditor;
    const folder = vscode.workspace.workspaceFolders?.[0];
    const doc = editor?.document;
    const fsPath = doc?.uri.fsPath;
    return {
        workspaceFolder: folder?.uri.fsPath,
        file: fsPath,
        fileBasename: fsPath ? fsPath.split(/[\\/]/).pop() : undefined,
        fileDirname: fsPath ? fsPath.replace(/[\\/][^\\/]*$/, '') : undefined,
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
    if (button.type === 'vscode-command') {
        const args = (button.args ?? []).map(a => (typeof a === 'string' ? (0, variableResolver_1.resolveVariables)(a, ctx) : a));
        await vscode.commands.executeCommand(button.command, ...args);
        return;
    }
    const cwd = button.cwd ? (0, variableResolver_1.resolveVariables)(button.cwd, ctx) : ctx.workspaceFolder;
    const command = (0, variableResolver_1.resolveVariables)(button.command, ctx);
    registry.dispatch(button.id, command, { cwd, focus: button.focus });
}
//# sourceMappingURL=runButton.js.map