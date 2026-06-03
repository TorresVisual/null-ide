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
exports.ClaudeHistoryIndex = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
// Claude Code encodes workspace paths as: lowercase drive letter, :\ → --, remaining \/ → -
// e.g. D:\Coding\Apps\null-ide → D--Coding-Apps-null-ide
function encodeProjectPath(workspacePath) {
    let p = workspacePath;
    p = p.replace(/^([A-Za-z]):[\\\/]/, (_, d) => d.toLowerCase() + '--');
    p = p.replace(/[\\\/]/g, '-');
    return p;
}
function parseSessionHead(filePath) {
    try {
        const buf = Buffer.alloc(8192);
        const fd = fs.openSync(filePath, 'r');
        const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
        fs.closeSync(fd);
        const rawLines = buf.slice(0, bytesRead).toString('utf8').split('\n');
        const lines = [];
        for (const line of rawLines) {
            const t = line.trim();
            if (!t)
                continue;
            try {
                lines.push(JSON.parse(t));
            }
            catch { }
            if (lines.length >= 40)
                break;
        }
        let aiTitle = '';
        let firstUserTitle = '';
        let model;
        let branch;
        let lastActive = '';
        let messageCount = 0;
        for (const line of lines) {
            if (!line || typeof line !== 'object')
                continue;
            if (typeof line['timestamp'] === 'string')
                lastActive = line['timestamp'];
            if (!branch && typeof line['gitBranch'] === 'string')
                branch = line['gitBranch'];
            // ai-title is the most reliable title — Claude Code generates it from conversation content
            if (line['type'] === 'ai-title' && typeof line['aiTitle'] === 'string') {
                aiTitle = line['aiTitle'].replace(/-/g, ' ').slice(0, 60);
            }
            if (line['type'] === 'user') {
                messageCount++;
                if (!firstUserTitle) {
                    const msg = line['message'];
                    const content = msg?.['content'];
                    let raw = '';
                    if (typeof content === 'string') {
                        raw = content;
                    }
                    else if (Array.isArray(content)) {
                        const textPart = content.find(c => c['type'] === 'text');
                        if (textPart && typeof textPart['text'] === 'string')
                            raw = textPart['text'];
                    }
                    if (raw) {
                        const cleaned = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                        if (cleaned.length >= 2)
                            firstUserTitle = cleaned.slice(0, 60);
                    }
                }
            }
            if (!model && line['type'] === 'assistant') {
                const msg = line['message'];
                if (typeof msg?.['model'] === 'string')
                    model = msg['model'];
            }
        }
        // If no ai-title found in the head, scan the tail of the file (last 4 KB).
        // Claude Code emits ai-title after the first assistant response, which can
        // be deep in a long session file and outside the 8 KB head window.
        if (!aiTitle) {
            try {
                const size = fs.statSync(filePath).size;
                const tailOffset = Math.max(0, size - 4096);
                if (tailOffset > 0) {
                    const tailBuf = Buffer.alloc(size - tailOffset);
                    const tailFd = fs.openSync(filePath, 'r');
                    fs.readSync(tailFd, tailBuf, 0, tailBuf.length, tailOffset);
                    fs.closeSync(tailFd);
                    for (const tline of tailBuf.toString('utf8').split('\n')) {
                        const t = tline.trim();
                        if (!t)
                            continue;
                        try {
                            const obj = JSON.parse(t);
                            if (obj['type'] === 'ai-title' && typeof obj['aiTitle'] === 'string') {
                                aiTitle = obj['aiTitle'].replace(/-/g, ' ').slice(0, 60);
                            }
                        }
                        catch { }
                    }
                }
            }
            catch { }
        }
        if (!aiTitle && !firstUserTitle && !lastActive)
            return null;
        const sessionId = path.basename(filePath, '.jsonl');
        if (!lastActive) {
            try {
                lastActive = fs.statSync(filePath).mtime.toISOString();
            }
            catch {
                lastActive = new Date().toISOString();
            }
        }
        // Prefer ai-title (Claude Code's generated slug), fall back to first user message
        const title = aiTitle || firstUserTitle || sessionId.slice(0, 8) + '…';
        return { sessionId, title, lastActive, messageCount, model, branch, filePath };
    }
    catch {
        return null;
    }
}
class ClaudeHistoryIndex {
    _workspaceRoot;
    _watcher = null;
    claudeProjectDir;
    constructor(_workspaceRoot) {
        this._workspaceRoot = _workspaceRoot;
        this.claudeProjectDir = this._resolve();
    }
    _resolve() {
        const homeDir = os.homedir();
        const encoded = encodeProjectPath(this._workspaceRoot);
        const direct = path.join(homeDir, '.claude', 'projects', encoded);
        if (fs.existsSync(direct))
            return direct;
        // Fallback: scan project dirs and match by cwd field in first .jsonl line
        try {
            const projectsRoot = path.join(homeDir, '.claude', 'projects');
            const dirs = fs.readdirSync(projectsRoot, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => path.join(projectsRoot, d.name));
            for (const dir of dirs) {
                try {
                    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
                    if (files.length === 0)
                        continue;
                    const sample = path.join(dir, files[0]);
                    const buf = Buffer.alloc(512);
                    const fd = fs.openSync(sample, 'r');
                    const n = fs.readSync(fd, buf, 0, 512, 0);
                    fs.closeSync(fd);
                    const firstLine = buf.slice(0, n).toString('utf8').split('\n')[0];
                    const obj = JSON.parse(firstLine);
                    const cwd = typeof obj['cwd'] === 'string' ? obj['cwd'] : '';
                    if (cwd && path.normalize(cwd).toLowerCase() === path.normalize(this._workspaceRoot).toLowerCase()) {
                        return dir;
                    }
                }
                catch { }
            }
        }
        catch { }
        return path.join(homeDir, '.claude', 'projects', encoded);
    }
    async build() {
        try {
            if (!fs.existsSync(this.claudeProjectDir))
                return [];
            const files = fs.readdirSync(this.claudeProjectDir)
                .filter((f) => f.endsWith('.jsonl'))
                .map((f) => path.join(this.claudeProjectDir, f));
            const withMtime = files.map((f) => {
                try {
                    return { f, mtime: fs.statSync(f).mtimeMs };
                }
                catch {
                    return { f, mtime: 0 };
                }
            }).sort((a, b) => b.mtime - a.mtime);
            const sessions = [];
            for (const { f } of withMtime) {
                const s = parseSessionHead(f);
                if (s)
                    sessions.push(s);
            }
            return sessions;
        }
        catch {
            return [];
        }
    }
    watch(onChange) {
        const dir = this.claudeProjectDir;
        const pattern = new vscode.RelativePattern(vscode.Uri.file(path.dirname(dir)), path.basename(dir) + '/*.jsonl');
        this._watcher = vscode.workspace.createFileSystemWatcher(pattern);
        const refresh = () => this.build().then(s => onChange(s));
        this._watcher.onDidCreate(refresh);
        this._watcher.onDidChange(refresh);
        this._watcher.onDidDelete(refresh);
    }
    dispose() {
        this._watcher?.dispose();
        this._watcher = null;
    }
}
exports.ClaudeHistoryIndex = ClaudeHistoryIndex;
//# sourceMappingURL=claudeHistory.js.map