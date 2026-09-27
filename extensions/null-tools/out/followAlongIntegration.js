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
exports.registerFollowAlongFeature = registerFollowAlongFeature;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const followAlong_1 = require("./followAlong");
const FADE_MS = 1200;
class FollowAlongWatcher {
    workspaceRoot;
    dirWatcher;
    fileWatcher;
    activeFile = null;
    offset = 0;
    addedDecorationType;
    removedDecorationType;
    fadeTimers = new Map();
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        // Reuse the diff editor's own theme colors so this reads like a git diff.
        this.addedDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
            isWholeLine: true,
        });
        this.removedDecorationType = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            borderStyle: 'solid',
            borderWidth: '2px 0 0 0',
            borderColor: new vscode.ThemeColor('diffEditor.removedTextBackground'),
        });
    }
    start() {
        const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
        const projectDir = (0, followAlong_1.findProjectDir)(claudeProjectsDir, this.workspaceRoot);
        if (projectDir) {
            this.watchProjectDir(projectDir);
        }
        else {
            this.watchForProjectDir(claudeProjectsDir);
        }
    }
    dispose() {
        this.dirWatcher?.close();
        this.fileWatcher?.close();
        this.addedDecorationType.dispose();
        this.removedDecorationType.dispose();
        for (const timer of this.fadeTimers.values())
            clearTimeout(timer);
        this.fadeTimers.clear();
    }
    watchForProjectDir(claudeProjectsDir) {
        try {
            this.dirWatcher = fs.watch(claudeProjectsDir, () => {
                const projectDir = (0, followAlong_1.findProjectDir)(claudeProjectsDir, this.workspaceRoot);
                if (projectDir) {
                    this.dirWatcher?.close();
                    this.dirWatcher = undefined;
                    this.watchProjectDir(projectDir);
                }
            });
        }
        catch {
            // ~/.claude/projects doesn't exist yet (no session has ever run) — nothing to watch.
        }
    }
    watchProjectDir(projectDir) {
        // Skip backlog: start from whatever session is newest right now, at its current end.
        const newest = (0, followAlong_1.pickNewestTranscript)(projectDir);
        if (newest) {
            this.activeFile = newest;
            this.offset = fs.statSync(newest).size;
        }
        try {
            this.fileWatcher = fs.watch(projectDir, (_event, filename) => {
                if (filename && !filename.endsWith('.jsonl'))
                    return;
                this.onTranscriptChange(projectDir);
            });
        }
        catch {
            // Project dir was removed concurrently — nothing to watch.
        }
    }
    onTranscriptChange(projectDir) {
        const newest = (0, followAlong_1.pickNewestTranscript)(projectDir);
        if (!newest)
            return;
        if (newest !== this.activeFile) {
            // A different (newer) session took over — don't replay its backlog either.
            this.activeFile = newest;
            this.offset = 0;
        }
        this.readAppended();
    }
    readAppended() {
        if (!this.activeFile)
            return;
        let size;
        try {
            size = fs.statSync(this.activeFile).size;
        }
        catch {
            return;
        }
        if (size <= this.offset) {
            this.offset = Math.min(this.offset, size);
            return;
        }
        const buf = Buffer.alloc(size - this.offset);
        let fd;
        try {
            fd = fs.openSync(this.activeFile, 'r');
        }
        catch {
            return;
        }
        try {
            fs.readSync(fd, buf, 0, buf.length, this.offset);
        }
        finally {
            fs.closeSync(fd);
        }
        const { lines, consumedLength } = (0, followAlong_1.parseAppendedLines)(buf.toString('utf8'));
        this.offset += consumedLength;
        for (const line of lines) {
            for (const edit of (0, followAlong_1.extractEdits)(line)) {
                void this.applyEdit(edit);
            }
        }
    }
    async applyEdit(edit) {
        if (!(0, followAlong_1.isPathInWorkspace)(edit.filePath, this.workspaceRoot))
            return;
        const splitView = vscode.workspace.getConfiguration('null.claude').get('followAlongSplitView', false);
        let editor;
        try {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(edit.filePath));
            editor = await vscode.window.showTextDocument(doc, {
                preview: false,
                preserveFocus: true,
                viewColumn: splitView ? vscode.ViewColumn.Two : undefined,
            });
        }
        catch {
            return; // File may have been deleted/renamed since the edit landed.
        }
        const lineCount = editor.document.lineCount;
        const clampLine = (n) => Math.min(lineCount - 1, Math.max(0, n));
        const startLine = clampLine(edit.newStart - 1);
        const endLine = clampLine(startLine + Math.max(0, edit.newLines - 1));
        editor.revealRange(new vscode.Range(startLine, 0, endLine, editor.document.lineAt(endLine).text.length), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        const addedRanges = edit.addedLines.map(n => {
            const line = clampLine(n - 1);
            return new vscode.Range(line, 0, line, 0);
        });
        // Removed text no longer exists in the buffer, so it can't be highlighted
        // in place — mark the line it used to precede with a red top border and
        // show the deleted text on hover, the way the diff editor's gutter does.
        const removedByLine = new Map();
        for (const removed of edit.removedLines) {
            const texts = removedByLine.get(removed.beforeLine) ?? [];
            texts.push(removed.text);
            removedByLine.set(removed.beforeLine, texts);
        }
        const removedDecorations = [...removedByLine].map(([beforeLine, texts]) => {
            const line = clampLine(beforeLine - 1);
            const hoverMessage = new vscode.MarkdownString();
            hoverMessage.appendCodeblock(texts.join('\n'), editor.document.languageId);
            return { range: new vscode.Range(line, 0, line, 0), hoverMessage };
        });
        editor.setDecorations(this.addedDecorationType, addedRanges);
        editor.setDecorations(this.removedDecorationType, removedDecorations);
        const priorFade = this.fadeTimers.get(edit.filePath);
        if (priorFade)
            clearTimeout(priorFade);
        this.fadeTimers.set(edit.filePath, setTimeout(() => {
            editor.setDecorations(this.addedDecorationType, []);
            editor.setDecorations(this.removedDecorationType, []);
            this.fadeTimers.delete(edit.filePath);
        }, FADE_MS));
    }
}
function registerFollowAlongFeature(context) {
    const bar = vscode.window.createStatusBarItem('null.followAlong', vscode.StatusBarAlignment.Right, 0);
    bar.command = 'null.toggleFollowAlong';
    context.subscriptions.push(bar);
    let watcher;
    const sync = () => {
        const enabled = vscode.workspace.getConfiguration('null.claude').get('followAlong', false);
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        bar.text = enabled ? '$(eye) Follow Along' : '$(eye-closed) Follow Along';
        bar.tooltip = enabled
            ? 'Null: watching Claude Code\'s edits live — click to disable'
            : 'Null: click to follow Claude Code\'s edits live in the editor';
        bar.show();
        if (enabled && root && !watcher) {
            watcher = new FollowAlongWatcher(root);
            watcher.start();
        }
        else if ((!enabled || !root) && watcher) {
            watcher.dispose();
            watcher = undefined;
        }
    };
    sync();
    context.subscriptions.push(vscode.commands.registerCommand('null.toggleFollowAlong', async () => {
        const cfg = vscode.workspace.getConfiguration('null.claude');
        await cfg.update('followAlong', !cfg.get('followAlong', false), vscode.ConfigurationTarget.Global);
    }), vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('null.claude.followAlong'))
            sync();
    }), vscode.workspace.onDidChangeWorkspaceFolders(() => sync()), { dispose: () => watcher?.dispose() });
}
//# sourceMappingURL=followAlongIntegration.js.map