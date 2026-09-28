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
exports.registerWhyIsThisHereFeature = registerWhyIsThisHereFeature;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const followAlong_1 = require("./followAlong");
const whyIsThisHere_1 = require("./whyIsThisHere");
const EXCERPT_LENGTH = 300;
// Watches the active Claude Code session's transcript (same approach as
// FollowAlongWatcher in followAlongIntegration.ts, minus the decorations)
// and keeps a WhyIndex of it up to date.
class WhyWatcher {
    workspaceRoot;
    dirWatcher;
    fileWatcher;
    activeFile = null;
    offset = 0;
    index = null;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    start() {
        const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
        const projectDir = (0, followAlong_1.findProjectDir)(claudeProjectsDir, this.workspaceRoot);
        if (projectDir)
            this.watchProjectDir(projectDir);
        else
            this.watchForProjectDir(claudeProjectsDir);
    }
    dispose() {
        this.dirWatcher?.close();
        this.fileWatcher?.close();
    }
    getIndex() {
        return this.index;
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
        // Skip backlog, same choice as Follow Along (#99): start indexing from
        // whatever session is newest right now, at its current end.
        const newest = (0, followAlong_1.pickNewestTranscript)(projectDir);
        if (newest) {
            this.activeFile = newest;
            this.offset = fs.statSync(newest).size;
            this.index = new whyIsThisHere_1.WhyIndex(path.basename(newest, '.jsonl'));
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
            this.activeFile = newest;
            this.offset = 0;
            this.index = new whyIsThisHere_1.WhyIndex(path.basename(newest, '.jsonl'));
        }
        this.readAppended();
    }
    readAppended() {
        if (!this.activeFile || !this.index)
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
        this.index.ingest(lines);
    }
}
function buildHoverMarkdown(annotation) {
    const md = new vscode.MarkdownString();
    if (annotation.sessionTitle) {
        md.appendMarkdown('**');
        md.appendText(annotation.sessionTitle);
        md.appendMarkdown('**\n\n');
    }
    if (annotation.prompt) {
        md.appendMarkdown('**You asked:** ');
        md.appendText((0, whyIsThisHere_1.excerpt)(annotation.prompt, EXCERPT_LENGTH));
        md.appendMarkdown('\n\n');
    }
    md.appendMarkdown('**Claude said:** ');
    if (annotation.claudeSaid) {
        md.appendText((0, whyIsThisHere_1.excerpt)(annotation.claudeSaid, EXCERPT_LENGTH));
    }
    else {
        md.appendMarkdown('_(no explanation — this edit landed without a preceding message)_');
    }
    md.appendMarkdown('\n\n');
    if (annotation.timestamp) {
        const when = new Date(annotation.timestamp);
        if (!Number.isNaN(when.getTime()))
            md.appendMarkdown(`*${when.toLocaleString()}*\n\n`);
    }
    md.appendMarkdown(`[Resume this session](vscode://anthropic.claude-code/open?session=${annotation.sessionId})`);
    return md;
}
function registerWhyIsThisHereFeature(context) {
    let watcher;
    let root;
    const sync = () => {
        const newRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (newRoot === root)
            return;
        watcher?.dispose();
        watcher = undefined;
        root = newRoot;
        if (root) {
            watcher = new WhyWatcher(root);
            watcher.start();
        }
    };
    sync();
    const hoverProvider = {
        provideHover(document, position) {
            if (!watcher || !root)
                return undefined;
            const index = watcher.getIndex();
            if (!index)
                return undefined;
            if (!(0, followAlong_1.isPathInWorkspace)(document.uri.fsPath, root))
                return undefined;
            const line = document.lineAt(position.line);
            const match = index.findAnnotation(document.uri.fsPath, position.line + 1, line.text);
            return match ? new vscode.Hover(buildHoverMarkdown(match.annotation), line.range) : undefined;
        },
    };
    context.subscriptions.push(vscode.languages.registerHoverProvider({ scheme: 'file' }, hoverProvider), vscode.workspace.onDidChangeWorkspaceFolders(() => sync()), { dispose: () => watcher?.dispose() });
}
//# sourceMappingURL=whyIsThisHereIntegration.js.map