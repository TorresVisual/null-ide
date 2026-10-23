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
exports.trackActiveEditor = trackActiveEditor;
exports.activeWorkspaceFolder = activeWorkspaceFolder;
const vscode = __importStar(require("vscode"));
// A focused webview (the settings panel) has no activeTextEditor, so remember the
// folder of the last file the user was in.
let lastSeen;
function remember(editor) {
    const uri = editor?.document.uri;
    // Files outside every workspace folder (scratch buffers, settings.json) must not erase the memory.
    if (uri && vscode.workspace.getWorkspaceFolder(uri)) {
        lastSeen = uri;
    }
}
function trackActiveEditor(context) {
    remember(vscode.window.activeTextEditor);
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(remember));
}
/** Folder of the active file, else of the last workspace file seen, else the first folder. */
function activeWorkspaceFolder() {
    const uri = vscode.window.activeTextEditor?.document.uri ?? lastSeen;
    return (uri && vscode.workspace.getWorkspaceFolder(uri)) ?? vscode.workspace.workspaceFolders?.[0];
}
//# sourceMappingURL=workspaceFolder.js.map