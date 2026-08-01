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
exports.PortsTreeProvider = void 0;
exports.scanPorts = scanPorts;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
// ── Well-known port → server label mapping ───────────────────────────────────
const WELL_KNOWN_PORTS = {
    1420: 'Tauri Dev',
    3000: 'React / Node',
    3001: 'Node Dev',
    4000: 'GraphQL / Node',
    4200: 'Angular',
    5000: 'Flask / Dev',
    5173: 'Vite',
    5174: 'Vite (secondary)',
    6006: 'Storybook',
    7860: 'Gradio',
    8000: 'Python / Django',
    8080: 'Dev Server',
    8081: 'Dev Server (alt)',
    8888: 'Jupyter',
    9000: 'PHP / Dev',
    9229: 'Node Inspector',
    11434: 'Ollama',
    24678: 'Vite HMR',
    1421: 'Tauri (alt)',
};
// ── Dev-relevant process name fragments ─────────────────────────────────────
const DEV_PROCESSES = new Set([
    'node', 'bun', 'deno', 'python', 'python3', 'uvicorn',
    'gunicorn', 'java', 'ruby', 'go', 'cargo', 'ollama',
    'nginx', 'caddy', 'httpd', 'apache', 'php',
    'tauri', 'wry', 'null-notes', 'vite',
]);
function isDevProcess(name) {
    const lower = name.toLowerCase().replace(/\.exe$/, '');
    for (const dev of DEV_PROCESSES) {
        if (lower.includes(dev)) {
            return true;
        }
    }
    return false;
}
// ── Icon mapping ─────────────────────────────────────────────────────────────
function resolveIcon(processName, port) {
    const lower = processName.toLowerCase();
    if (port === 11434 || lower.includes('ollama')) {
        return '$(hubot)';
    }
    if (lower.includes('python') || lower.includes('uvicorn') || lower.includes('gunicorn')) {
        return '$(terminal-linux)';
    }
    if (lower.includes('java')) {
        return '$(coffee)';
    }
    if (lower.includes('ruby')) {
        return '$(gem)';
    }
    if (lower.includes('tauri') || lower.includes('wry') || lower.includes('cargo')) {
        return '$(zap)';
    }
    if (lower.includes('node') || lower.includes('bun') || lower.includes('deno')) {
        return '$(rocket)';
    }
    if (lower.includes('nginx') || lower.includes('caddy') || lower.includes('apache') || lower.includes('httpd')) {
        return '$(server)';
    }
    // Vite is launched via node — if on a well-known Vite port, use rocket icon
    if (port === 5173 || port === 5174 || port === 24678 || port === 1420) {
        return '$(rocket)';
    }
    return '$(plug)';
}
function scanListeningPorts() {
    try {
        const raw = (0, child_process_1.execSync)('netstat -ano', { encoding: 'utf8', timeout: 5000, windowsHide: true });
        const results = [];
        const seen = new Set();
        for (const line of raw.split('\n')) {
            // Match all TCP LISTENING lines regardless of local address family.
            // Windows netstat formats local address as:
            //   IPv4:  0.0.0.0:PORT  or  127.0.0.1:PORT
            //   IPv6:  [::]:PORT     or  [::1]:PORT
            // We accept any local-only / wildcard address so nothing is missed.
            const m = line.match(/^\s*TCP\s+(?:0\.0\.0\.0|127\.(?:\d+\.){2}\d+|\[::\]|\[::1\]|\[fe80[^\]]*\])?:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
            if (!m) {
                continue;
            }
            const port = parseInt(m[1], 10);
            const pid = parseInt(m[2], 10);
            if (!seen.has(port) && port > 0 && port < 65536) {
                seen.add(port);
                results.push({ port, pid });
            }
        }
        return results;
    }
    catch {
        return [];
    }
}
function resolveProcessNames(pids) {
    const map = new Map();
    if (pids.length === 0) {
        return map;
    }
    try {
        const raw = (0, child_process_1.execSync)('tasklist /fo csv /nh', { encoding: 'utf8', timeout: 5000, windowsHide: true });
        for (const line of raw.split('\n')) {
            // CSV format: "node.exe","12345","Console","1","123,456 K"
            const m = line.match(/^"([^"]+)","([\d]+)"/);
            if (!m) {
                continue;
            }
            const pid = parseInt(m[2], 10);
            const name = m[1].replace(/\.exe$/i, '').toLowerCase();
            if (pids.includes(pid)) {
                map.set(pid, name);
            }
        }
    }
    catch {
        // tasklist failed — leave map empty; entries will still show with PID only
    }
    return map;
}
function scanPorts(filterDevOnly) {
    const rawPorts = scanListeningPorts();
    if (rawPorts.length === 0) {
        return [];
    }
    const allPids = [...new Set(rawPorts.map(r => r.pid))];
    const pidNames = resolveProcessNames(allPids);
    const entries = [];
    for (const { port, pid } of rawPorts) {
        const processName = pidNames.get(pid) ?? `pid-${pid}`;
        if (filterDevOnly && !isDevProcess(processName) && !WELL_KNOWN_PORTS[port]) {
            continue;
        }
        const friendlyLabel = WELL_KNOWN_PORTS[port] ?? '';
        const iconId = resolveIcon(processName, port);
        entries.push({ port, pid, processName, friendlyLabel, iconId });
    }
    return entries.sort((a, b) => a.port - b.port);
}
// ── TreeDataProvider ─────────────────────────────────────────────────────────
class PortsTreeProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    _entries = [];
    _timer;
    _filterDevOnly = true;
    constructor() {
        this._scan();
    }
    // ── Public API ─────────────────────────────────────────────────────────────
    refresh() {
        this._scan();
    }
    startAutoRefresh(intervalSec) {
        this._stopAutoRefresh();
        if (intervalSec > 0) {
            this._timer = setInterval(() => this._scan(), intervalSec * 1000);
        }
    }
    stopAutoRefresh() {
        this._stopAutoRefresh();
    }
    setFilterDevOnly(value) {
        this._filterDevOnly = value;
        this._scan();
    }
    get entries() {
        return this._entries;
    }
    // ── TreeDataProvider implementation ────────────────────────────────────────
    getTreeItem(entry) {
        const label = `${entry.processName}  :${entry.port}`;
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.description = entry.friendlyLabel || undefined;
        item.tooltip = new vscode.MarkdownString(`**${entry.processName}** on port **${entry.port}**\n\n` +
            `PID: \`${entry.pid}\`\n\n` +
            (entry.friendlyLabel ? `Server: ${entry.friendlyLabel}\n\n` : '') +
            `URL: [http://localhost:${entry.port}](http://localhost:${entry.port})`);
        item.iconPath = new vscode.ThemeIcon(entry.iconId.replace(/^\$\(/, '').replace(/\)$/, ''), new vscode.ThemeColor('charts.green'));
        item.contextValue = 'portEntry';
        // Store data for commands via the item id
        item.id = `port-${entry.port}-${entry.pid}`;
        return item;
    }
    getChildren() {
        return this._entries;
    }
    // ── Private ────────────────────────────────────────────────────────────────
    _scan() {
        this._entries = scanPorts(this._filterDevOnly);
        this._onDidChangeTreeData.fire();
    }
    _stopAutoRefresh() {
        if (this._timer !== undefined) {
            clearInterval(this._timer);
            this._timer = undefined;
        }
    }
}
exports.PortsTreeProvider = PortsTreeProvider;
//# sourceMappingURL=portsTreeView.js.map