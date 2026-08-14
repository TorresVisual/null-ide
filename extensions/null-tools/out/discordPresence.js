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
exports.DiscordPresenceManager = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const discordRpcClient_1 = require("./discordRpcClient");
const NULL_REPO_URL = 'https://github.com/TorresVisual/null-ide';
/** Maps VS Code language IDs to Discord Rich Presence asset keys. */
const LANGUAGE_KEYS = {
    typescript: 'typescript',
    typescriptreact: 'typescript',
    javascript: 'javascript',
    javascriptreact: 'javascript',
    python: 'python',
    rust: 'rust',
    go: 'go',
    java: 'java',
    csharp: 'csharp',
    cpp: 'cpp',
    c: 'c',
    html: 'html',
    css: 'css',
    scss: 'scss',
    json: 'json',
    markdown: 'markdown',
    yaml: 'yaml',
    sql: 'sql',
    shellscript: 'shell',
    powershell: 'powershell',
    ruby: 'ruby',
    php: 'php',
    swift: 'swift',
    kotlin: 'kotlin',
    dart: 'dart',
    lua: 'lua',
    r: 'r',
    dockerfile: 'docker',
};
function getConfig() {
    const cfg = vscode.workspace.getConfiguration('null.discord');
    const clientId = (cfg.get('clientId') ?? '').trim();
    return {
        enabled: cfg.get('enabled', true),
        clientId,
        showFileName: cfg.get('showFileName', true),
        showWorkspace: cfg.get('showWorkspace', true),
        privacyMode: cfg.get('privacyMode', false),
        idleTimeoutSec: cfg.get('idleTimeoutSec', 300),
        showDebug: cfg.get('showDebug', true),
        showRepositoryButton: cfg.get('showRepositoryButton', true),
    };
}
function languageKey(document) {
    const mapped = LANGUAGE_KEYS[document.languageId];
    if (mapped) {
        return mapped;
    }
    const id = document.languageId.replace(/[^a-z0-9]+/gi, '').toLowerCase();
    return id || 'code';
}
function languageLabel(document) {
    return document.languageId
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/react$/i, ' React')
        .replace(/^./, (c) => c.toUpperCase());
}
function workspaceLabel(editor) {
    if (!editor) {
        return undefined;
    }
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (folder?.name) {
        return folder.name;
    }
    if (vscode.workspace.name) {
        return vscode.workspace.name;
    }
    return undefined;
}
function truncate(text, max) {
    if (text.length <= max) {
        return text;
    }
    return `${text.slice(0, max - 1)}…`;
}
async function gitRemoteUrl() {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (!gitExt) {
        return undefined;
    }
    try {
        const git = gitExt.isActive ? gitExt.exports.getAPI(1) : (await gitExt.activate()).getAPI(1);
        const repo = git.repositories.find((r) => r.ui.selected) ?? git.repositories[0];
        const remote = repo?.state?.remotes?.[0]?.fetchUrl;
        if (!remote) {
            return undefined;
        }
        if (remote.startsWith('git@') || remote.startsWith('ssh://')) {
            return remote.replace('ssh://', '').replace(':', '/').replace(/^git@/, 'https://').replace(/\.git$/, '');
        }
        return remote.replace(/(https:\/\/)([^@]*)@/, '$1').replace(/\.git$/, '');
    }
    catch {
        return undefined;
    }
}
class DiscordPresenceManager {
    client = null;
    connected = false;
    sessionStart = Date.now();
    lastActivityAt = Date.now();
    updateTimer;
    reconnectTimer;
    disposed = false;
    start() {
        void this.scheduleUpdate(0);
    }
    dispose() {
        this.disposed = true;
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        void this.client?.clearActivity().catch(() => undefined);
        void this.client?.disconnect().catch(() => undefined);
        this.client = null;
        this.connected = false;
    }
    notifyActivity() {
        this.lastActivityAt = Date.now();
        void this.scheduleUpdate(750);
    }
    notifyConfigChange() {
        void this.client?.disconnect().catch(() => undefined);
        this.client = null;
        this.connected = false;
        void this.scheduleUpdate(0);
    }
    async scheduleUpdate(delayMs) {
        if (this.disposed) {
            return;
        }
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }
        this.updateTimer = setTimeout(() => {
            void this.pushPresence();
        }, delayMs);
    }
    async pushPresence() {
        if (this.disposed) {
            return;
        }
        const config = getConfig();
        if (!config.enabled || !config.clientId) {
            if (this.connected) {
                await this.client?.clearActivity().catch(() => undefined);
                await this.client?.disconnect().catch(() => undefined);
                this.client = null;
                this.connected = false;
            }
            return;
        }
        try {
            if (!this.client) {
                this.client = new discordRpcClient_1.DiscordRpcClient(config.clientId);
            }
            if (!this.connected) {
                await this.client.connect();
                this.connected = true;
            }
            const activity = await this.buildActivity(config);
            await this.client.setActivity(activity);
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = undefined;
            }
        }
        catch {
            this.connected = false;
            await this.client?.disconnect().catch(() => undefined);
            this.client = null;
            this.queueReconnect();
        }
    }
    queueReconnect() {
        if (this.disposed || this.reconnectTimer) {
            return;
        }
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            void this.scheduleUpdate(0);
        }, 15_000);
    }
    async buildActivity(config) {
        const editor = vscode.window.activeTextEditor;
        const debugging = config.showDebug && !!vscode.debug.activeDebugSession;
        const idle = config.idleTimeoutSec > 0
            && Date.now() - this.lastActivityAt >= config.idleTimeoutSec * 1000;
        const activity = {
            startTimestamp: this.sessionStart,
            smallImageKey: 'null',
            smallImageText: 'Null IDE',
        };
        if (config.showRepositoryButton) {
            const repoUrl = await gitRemoteUrl();
            activity.buttons = [{
                    label: repoUrl ? 'View Repository' : 'Null IDE',
                    url: repoUrl ?? NULL_REPO_URL,
                }];
        }
        if (debugging) {
            activity.details = 'Debugging';
            activity.state = config.showWorkspace ? workspaceLabel(editor) ?? 'Null IDE' : undefined;
            activity.largeImageKey = 'debug';
            activity.largeImageText = 'Debugging';
            return activity;
        }
        if (!editor || idle) {
            activity.details = idle ? 'Idle in Null IDE' : 'In Null IDE';
            activity.state = config.showWorkspace ? workspaceLabel(editor) ?? (idle ? undefined : 'Idle') : undefined;
            activity.largeImageKey = 'null';
            activity.largeImageText = 'Null IDE';
            return activity;
        }
        const langKey = languageKey(editor.document);
        const langText = languageLabel(editor.document);
        if (config.privacyMode) {
            activity.details = 'Editing code';
            activity.state = config.showWorkspace ? workspaceLabel(editor) : langText;
        }
        else if (config.showFileName) {
            activity.details = truncate(path.basename(editor.document.fileName), 128);
            activity.state = config.showWorkspace
                ? workspaceLabel(editor) ?? langText
                : langText;
        }
        else {
            activity.details = langText;
            activity.state = config.showWorkspace ? workspaceLabel(editor) : undefined;
        }
        activity.largeImageKey = langKey;
        activity.largeImageText = langText;
        return activity;
    }
}
exports.DiscordPresenceManager = DiscordPresenceManager;
//# sourceMappingURL=discordPresence.js.map