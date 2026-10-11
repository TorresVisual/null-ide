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
exports.startHeartbeatSource = startHeartbeatSource;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const tracker_1 = require("./tracker");
const TRACKED_SCHEMES = new Set(['file', 'untitled']);
const isTracked = (doc) => !!doc && TRACKED_SCHEMES.has(doc.uri.scheme);
function contextOf(doc) {
    const folder = (doc && vscode.workspace.getWorkspaceFolder(doc.uri)) ?? vscode.workspace.workspaceFolders?.[0];
    const workspace = folder?.uri.fsPath;
    const language = doc?.languageId ?? '';
    if (doc?.uri.scheme !== 'file')
        return { language, workspace };
    const rel = folder ? path.relative(folder.uri.fsPath, doc.uri.fsPath) : '';
    const inside = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
    return { file: (inside ? rel : path.basename(doc.uri.fsPath)).replace(/\\/g, '/'), language, workspace };
}
/**
 * Turns VS Code events into heartbeats. The stable API exposes no terminal keystrokes, so terminal
 * activity is shell-integration command start/end plus active-terminal changes. Edits to any open
 * file count, not just the active editor's, so AI-agent edits to background files are tracked
 * (attributed to the edited file; a multi-file refactor makes one heartbeat per file).
 */
function startHeartbeatSource(service) {
    const send = (doc, extra = {}) => service.recordActivity({ ts: Date.now(), ...contextOf(doc), isWrite: false, linesAdded: 0, linesRemoved: 0, ...extra });
    const active = () => vscode.window.activeTextEditor?.document;
    return vscode.Disposable.from(vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.contentChanges.length > 0 && isTracked(e.document)) {
            send(e.document, (0, tracker_1.lineDelta)(e.contentChanges));
        }
    }), vscode.window.onDidChangeTextEditorSelection((e) => {
        if (isTracked(e.textEditor.document))
            send(e.textEditor.document);
    }), vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
        if (isTracked(e.textEditor.document))
            send(e.textEditor.document);
    }), vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (isTracked(editor?.document))
            send(editor.document);
    }), vscode.workspace.onDidSaveTextDocument((doc) => {
        if (isTracked(doc))
            send(doc, { isWrite: true });
    }), vscode.window.onDidChangeActiveTerminal(() => send(undefined)), vscode.window.onDidStartTerminalShellExecution(() => send(undefined)), vscode.window.onDidEndTerminalShellExecution(() => send(undefined)), vscode.debug.onDidStartDebugSession(() => send(active())), vscode.debug.onDidTerminateDebugSession(() => send(active())), vscode.window.onDidChangeWindowState((state) => service.setFocused(state.focused)));
}
//# sourceMappingURL=heartbeatSource.js.map