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
const discordAppInfo_1 = require("./discordAppInfo");
const presenceOwnership_1 = require("./presenceOwnership");
const NULL_REPO_URL = 'https://github.com/TorresVisual/null-ide';
/** Discord shows the *application's* name as "Playing …"; ours must match. */
const EXPECTED_APP_NAME = 'Null IDE';
/** Asset key for the app icon shown in the large slot. */
const LARGE_IMAGE_KEY = 'null';
/** Generic asset used when a language has no icon of its own. */
const FALLBACK_IMAGE_KEY = 'code';
const output = vscode.window.createOutputChannel('Null Discord');
/**
 * Discord throttles Rich Presence to 5 updates per 20 seconds; anything past
 * that is silently dropped and the presence appears frozen. 5s keeps us at 4
 * per window, leaving headroom for timer jitter.
 */
const MIN_UPDATE_INTERVAL_MS = 5_000;
/** Collapse a burst of edits into one update once typing pauses. */
const ACTIVITY_DEBOUNCE_MS = 750;
/** How often a non-owner window re-checks whether it can take over. */
const OWNERSHIP_POLL_MS = 20_000;
const RECONNECT_BASE_MS = 15_000;
const RECONNECT_MAX_MS = 5 * 60_000;
/** Discord rejects details/state outside these bounds. */
const FIELD_MAX_LEN = 128;
const FIELD_MIN_LEN = 2;
const BUTTON_LABEL_MAX_LEN = 32;
const HTTP_TIMEOUT_MS = 6_000;
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
    jsonc: 'json',
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
/** Human-readable names for language IDs that title-casing mangles. */
const LANGUAGE_LABELS = {
    typescript: 'TypeScript',
    typescriptreact: 'TypeScript React',
    javascript: 'JavaScript',
    javascriptreact: 'JavaScript React',
    csharp: 'C#',
    cpp: 'C++',
    c: 'C',
    html: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    less: 'Less',
    json: 'JSON',
    jsonc: 'JSON',
    yaml: 'YAML',
    xml: 'XML',
    sql: 'SQL',
    shellscript: 'Shell',
    powershell: 'PowerShell',
    bat: 'Batch',
    php: 'PHP',
    r: 'R',
    dockerfile: 'Dockerfile',
    makefile: 'Makefile',
    markdown: 'Markdown',
    plaintext: 'Plain Text',
    vue: 'Vue',
    objectivec: 'Objective-C',
    fsharp: 'F#',
    ini: 'INI',
    toml: 'TOML',
};
function getConfig() {
    const cfg = vscode.workspace.getConfiguration('null.discord');
    const clientId = (cfg.get('clientId') ?? '').trim();
    const transport = cfg.get('transport', 'auto');
    return {
        enabled: cfg.get('enabled', true),
        clientId,
        transport: transport === 'ipc' || transport === 'websocket' ? transport : 'auto',
        showFileName: cfg.get('showFileName', true),
        showWorkspace: cfg.get('showWorkspace', true),
        privacyMode: cfg.get('privacyMode', false),
        idleTimeoutSec: cfg.get('idleTimeoutSec', 300),
        showDebug: cfg.get('showDebug', true),
        showRepositoryButton: cfg.get('showRepositoryButton', true),
    };
}
function languageKey(document) {
    return LANGUAGE_KEYS[document.languageId];
}
function languageLabel(document) {
    const id = document.languageId;
    const known = LANGUAGE_LABELS[id];
    if (known) {
        return known;
    }
    return id
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[-_]+/g, ' ')
        .replace(/\b./g, (c) => c.toUpperCase());
}
function workspaceLabel(editor) {
    if (editor) {
        const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (folder?.name) {
            return folder.name;
        }
    }
    // Fall back to the window's workspace even with no editor open, so the
    // "Idle"/"In Null IDE" states still say which project you are in.
    if (vscode.workspace.name) {
        return vscode.workspace.name;
    }
    return vscode.workspace.workspaceFolders?.[0]?.name;
}
/** Clamps a value to Discord's field limits, or drops it if too short. */
function clampField(text) {
    if (!text) {
        return undefined;
    }
    const trimmed = text.trim();
    if (trimmed.length < FIELD_MIN_LEN) {
        return undefined;
    }
    if (trimmed.length <= FIELD_MAX_LEN) {
        return trimmed;
    }
    return `${trimmed.slice(0, FIELD_MAX_LEN - 1)}…`;
}
function normalizeGitUrl(remote) {
    let url = remote.trim();
    if (url.startsWith('git@')) {
        url = `https://${url.slice(4).replace(':', '/')}`;
    }
    else if (url.startsWith('ssh://')) {
        url = url.replace(/^ssh:\/\/(?:git@)?/, 'https://').replace(':', '/');
    }
    url = url.replace(/^(https?:\/\/)(?:[^@/]+@)/, '$1');
    return url.replace(/\.git$/, '');
}
function buttonLabelForUrl(url) {
    try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        if (host === 'github.com') {
            return 'View on GitHub';
        }
        if (host === 'gitlab.com') {
            return 'View on GitLab';
        }
        if (host === 'bitbucket.org') {
            return 'View on Bitbucket';
        }
    }
    catch {
        // Fall through to generic label.
    }
    return 'View Repository';
}
function isValidClientId(clientId) {
    return /^\d{17,20}$/.test(clientId);
}
function log(message) {
    output.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
}
class DiscordPresenceManager {
    client = null;
    connected = false;
    sessionStart = Date.now();
    lastActivityAt = Date.now();
    ownership;
    updateTimer;
    updateDueAt = Number.POSITIVE_INFINITY;
    idleTimer;
    reconnectTimer;
    reconnectAttempts = 0;
    pushing = false;
    lastSentAt = 0;
    lastPayloadKey = '';
    appInfoPromise;
    appInfoClientId = '';
    warnedMissingLargeAsset = false;
    repoButton;
    repoButtonResolved = false;
    disposed = false;
    warnedMissingClientId = false;
    lastError = '';
    constructor(storageDir) {
        this.ownership = new presenceOwnership_1.PresenceOwnership(storageDir, log);
    }
    start() {
        if (vscode.window.state.focused) {
            this.ownership.claim(workspaceLabel());
        }
        this.scheduleUpdate(0);
    }
    dispose() {
        this.disposed = true;
        this.clearTimers();
        // Hand ownership over before we go, so a sibling window picks it up at once.
        this.ownership.release();
        const client = this.client;
        this.client = null;
        this.connected = false;
        if (client) {
            void client.clearActivity()
                .catch(() => undefined)
                .then(() => client.disconnect(true))
                .catch(() => undefined);
        }
    }
    notifyActivity() {
        this.lastActivityAt = Date.now();
        this.scheduleUpdate(ACTIVITY_DEBOUNCE_MS);
    }
    /** This window came to the front — it becomes the presence owner. */
    notifyFocus() {
        this.ownership.claim(workspaceLabel());
        this.lastActivityAt = Date.now();
        // We may have been silent as a non-owner; make sure we republish.
        this.forceRefresh();
        this.scheduleUpdate(0);
    }
    /** Config changed — drop the connection so the new clientId/transport applies. */
    notifyConfigChange() {
        this.warnedMissingClientId = false;
        this.lastError = '';
        this.reconnectAttempts = 0;
        this.resetRepoCache();
        this.forceRefresh();
        void this.teardownClient();
        this.scheduleUpdate(0);
    }
    notifyWorkspaceChange() {
        this.resetRepoCache();
        this.notifyActivity();
    }
    async testConnection() {
        const config = getConfig();
        if (!config.enabled) {
            const action = await vscode.window.showWarningMessage('Null Discord: Rich Presence is turned off (null.discord.enabled).', 'Enable');
            if (action !== 'Enable') {
                return;
            }
            await vscode.workspace.getConfiguration('null.discord')
                .update('enabled', true, vscode.ConfigurationTarget.Global);
        }
        if (!config.clientId) {
            const action = await vscode.window.showWarningMessage('Null Discord: set null.discord.clientId to your Discord Application ID first.', 'Open Settings');
            if (action === 'Open Settings') {
                await vscode.commands.executeCommand('workbench.action.openSettings', 'null.discord.clientId');
            }
            return;
        }
        if (!isValidClientId(config.clientId)) {
            vscode.window.showErrorMessage('Null Discord: clientId must be a numeric Discord Application ID (17–20 digits).');
            return;
        }
        output.show(true);
        log('──────── Rich Presence diagnostics ────────');
        // Claim ownership so the test reflects this window even if another one has it.
        this.ownership.claim(workspaceLabel());
        await this.teardownClient();
        this.reconnectAttempts = 0;
        this.forceRefresh();
        this.resetRepoCache();
        this.appInfoPromise = undefined;
        this.appInfoClientId = '';
        const problems = await this.reportDiagnostics(config);
        try {
            await this.pushPresence({ force: true, throwOnError: true });
            log(`Transport: ${this.client?.transportKind ?? 'unknown'}`);
            log('Presence pushed successfully.');
            log('───────────────────────────────────────────');
            if (problems.length > 0) {
                vscode.window.showWarningMessage(`Null Discord: connected, but ${problems.length} configuration issue(s) found — see the Null Discord output.`);
            }
            else {
                vscode.window.showInformationMessage('Null Discord: connected and updated your presence.');
            }
        }
        catch (err) {
            log('───────────────────────────────────────────');
            vscode.window.showErrorMessage(`Null Discord: ${err.message}`);
        }
    }
    /** Checks the Developer Portal setup and writes findings to the output channel. */
    async reportDiagnostics(config) {
        const problems = [];
        const info = await this.getAppInfo(config.clientId);
        if (info.name) {
            log(`Application name: "${info.name}"`);
            if (info.name !== EXPECTED_APP_NAME) {
                problems.push('app name');
                log(`  ⚠ Discord shows this name as "Playing ${info.name}". The name comes from the `
                    + `Developer Portal, not from this extension — rename the application to `
                    + `"${EXPECTED_APP_NAME}" at https://discord.com/developers/applications/${config.clientId}`);
            }
        }
        else {
            log('Application name: could not be read (offline, or the ID is wrong).');
        }
        if (info.reliable) {
            log(`Rich Presence assets uploaded: ${info.assets.size}`);
            if (!info.assets.has(LARGE_IMAGE_KEY)) {
                problems.push('large image');
                log(`  ⚠ No asset named "${LARGE_IMAGE_KEY}". Discord drops the large image and promotes `
                    + `the language icon into the big slot — that is why the language logo appears large. `
                    + `Upload your app icon as "${LARGE_IMAGE_KEY}" under Rich Presence → Art Assets.`);
            }
            if (!info.assets.has(FALLBACK_IMAGE_KEY)) {
                problems.push('fallback image');
                log(`  ⚠ No asset named "${FALLBACK_IMAGE_KEY}" — languages without their own icon will show no small image.`);
            }
            const missing = [...new Set(Object.values(LANGUAGE_KEYS))]
                .filter((key) => !info.assets.has(key))
                .sort();
            if (missing.length > 0) {
                log(`  ℹ Languages with no uploaded icon (they fall back to "${FALLBACK_IMAGE_KEY}"): ${missing.join(', ')}`);
            }
        }
        if (config.showRepositoryButton) {
            const button = await this.resolveRepoButton();
            if (button) {
                log(`Button: "${button.label}" → ${button.url}`);
                log('  ℹ Discord never renders Rich Presence buttons on your own profile. Ask a friend, or check from the mobile app.');
            }
            else {
                log('Button: disabled (no public repository detected).');
            }
        }
        return problems;
    }
    clearTimers() {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
            this.updateTimer = undefined;
        }
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = undefined;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        this.updateDueAt = Number.POSITIVE_INFINITY;
    }
    resetRepoCache() {
        this.repoButton = undefined;
        this.repoButtonResolved = false;
    }
    /** Makes the next push send even if the payload is unchanged. */
    forceRefresh() {
        this.lastPayloadKey = '';
    }
    async teardownClient() {
        const client = this.client;
        this.client = null;
        this.connected = false;
        if (client) {
            await client.disconnect(true).catch(() => undefined);
        }
    }
    /**
     * Requests a presence update no sooner than `delayMs`, never violating
     * Discord's rate limit, and never pushing an already-pending update further
     * into the future (otherwise continuous typing would starve it forever).
     */
    scheduleUpdate(delayMs) {
        if (this.disposed) {
            return;
        }
        const now = Date.now();
        const throttleWait = Math.max(0, MIN_UPDATE_INTERVAL_MS - (now - this.lastSentAt));
        const delay = Math.max(delayMs, throttleWait);
        const dueAt = now + delay;
        if (this.updateTimer && this.updateDueAt <= dueAt) {
            return;
        }
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }
        this.updateDueAt = dueAt;
        this.updateTimer = setTimeout(() => {
            this.updateTimer = undefined;
            this.updateDueAt = Number.POSITIVE_INFINITY;
            void this.pushPresence();
        }, delay);
    }
    async pushPresence(options = {}) {
        if (this.disposed) {
            return;
        }
        // A slow connect must not overlap with the next scheduled tick.
        if (this.pushing) {
            this.scheduleUpdate(ACTIVITY_DEBOUNCE_MS);
            return;
        }
        const config = getConfig();
        if (!config.enabled) {
            if (this.connected) {
                log('Rich Presence disabled — clearing activity.');
                await this.client?.clearActivity().catch(() => undefined);
                await this.teardownClient();
            }
            this.clearTimers();
            this.ownership.release();
            return;
        }
        if (!config.clientId) {
            await this.warnMissingClientId();
            return;
        }
        if (!isValidClientId(config.clientId)) {
            this.logOnce(`Invalid clientId "${config.clientId}" — expected a numeric Discord Application ID.`);
            return;
        }
        this.pushing = true;
        try {
            // Only one Null IDE window may publish, otherwise Discord flaps between
            // projects. Non-owners release their connection and wait their turn.
            if (!this.ownership.isOwner(workspaceLabel())) {
                // Disconnect rather than clearing: Discord drops an activity when its
                // connection closes, and an explicit clear could race with — and wipe —
                // the presence the new owner has just published.
                if (this.connected) {
                    await this.teardownClient();
                }
                this.scheduleUpdate(OWNERSHIP_POLL_MS);
                return;
            }
            if (!this.client) {
                this.client = new discordRpcClient_1.DiscordRpcClient(config.clientId, log, config.transport, (reason) => this.handleUnexpectedDisconnect(reason));
            }
            if (!this.connected) {
                log(`Connecting to Discord (application ${config.clientId})…`);
                await this.client.connect();
                this.connected = true;
                this.reconnectAttempts = 0;
                this.lastError = '';
                this.forceRefresh();
                log('Connected to Discord.');
            }
            const activity = await this.buildActivity(config);
            const payloadKey = JSON.stringify(activity);
            if (!options.force && payloadKey === this.lastPayloadKey) {
                // Nothing visible changed — spending one of our 5-per-20s budget on an
                // identical payload would only delay a real update.
                this.scheduleIdleCheck(config);
                return;
            }
            await this.client.setActivity(activity);
            this.lastSentAt = Date.now();
            this.lastPayloadKey = payloadKey;
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = undefined;
            }
            this.scheduleIdleCheck(config);
        }
        catch (err) {
            const message = err.message;
            this.logOnce(`Presence update failed: ${message}`);
            await this.teardownClient();
            this.forceRefresh();
            this.queueReconnect();
            if (options.throwOnError) {
                throw err;
            }
        }
        finally {
            this.pushing = false;
        }
    }
    async warnMissingClientId() {
        if (this.warnedMissingClientId) {
            return;
        }
        this.warnedMissingClientId = true;
        log('Rich Presence is enabled but null.discord.clientId is empty.');
        const action = await vscode.window.showInformationMessage('Null Discord Rich Presence needs a Discord Application ID in settings.', 'Open Settings', 'Dismiss');
        if (action === 'Open Settings') {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'null.discord.clientId');
        }
    }
    logOnce(message) {
        if (message === this.lastError) {
            return;
        }
        this.lastError = message;
        log(message);
    }
    handleUnexpectedDisconnect(reason) {
        if (this.disposed || !this.connected) {
            return;
        }
        this.connected = false;
        this.forceRefresh();
        this.logOnce(`Discord connection lost: ${reason}`);
        this.queueReconnect();
    }
    /**
     * Nothing else wakes us up once the user stops typing, so the transition to
     * "Idle" needs its own timer at the exact moment the timeout elapses.
     */
    scheduleIdleCheck(config) {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = undefined;
        }
        if (this.disposed || config.idleTimeoutSec <= 0) {
            return;
        }
        const wait = this.lastActivityAt + config.idleTimeoutSec * 1000 - Date.now();
        if (wait <= 0) {
            return;
        }
        this.idleTimer = setTimeout(() => {
            this.idleTimer = undefined;
            this.scheduleUpdate(0);
        }, wait + 250);
    }
    queueReconnect() {
        if (this.disposed || this.reconnectTimer) {
            return;
        }
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** Math.min(this.reconnectAttempts, 5), RECONNECT_MAX_MS);
        this.reconnectAttempts++;
        log(`Retrying in ${Math.round(delay / 1000)}s.`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            this.scheduleUpdate(0);
        }, delay);
    }
    async buildActivity(config) {
        const editor = vscode.window.activeTextEditor;
        const debugging = config.showDebug && !!vscode.debug.activeDebugSession;
        const idle = config.idleTimeoutSec > 0
            && Date.now() - this.lastActivityAt >= config.idleTimeoutSec * 1000;
        const info = await this.getAppInfo(config.clientId);
        const largeImageKey = (0, discordAppInfo_1.resolveAssetKey)(info, LARGE_IMAGE_KEY, FALLBACK_IMAGE_KEY);
        const activity = { startTimestamp: this.sessionStart };
        if (largeImageKey) {
            activity.largeImageKey = largeImageKey;
            activity.largeImageText = EXPECTED_APP_NAME;
        }
        if (config.showRepositoryButton) {
            const button = await this.resolveRepoButton();
            if (button) {
                activity.buttons = [button];
            }
        }
        const workspace = config.showWorkspace ? clampField(workspaceLabel(editor)) : undefined;
        if (debugging) {
            activity.details = 'Debugging';
            activity.state = workspace;
            this.applySmallImage(activity, info, 'debug', 'Debugging');
            return activity;
        }
        if (!editor || idle) {
            activity.details = idle ? 'Idle' : 'In Null IDE';
            activity.state = workspace;
            return activity;
        }
        const langText = languageLabel(editor.document);
        this.applySmallImage(activity, info, languageKey(editor.document), langText);
        if (config.privacyMode) {
            activity.details = 'Editing code';
            activity.state = workspace ?? langText;
        }
        else if (config.showFileName) {
            activity.details = clampField(fileLabel(editor.document)) ?? langText;
            activity.state = workspace ?? langText;
        }
        else {
            activity.details = langText;
            activity.state = workspace;
        }
        return activity;
    }
    /**
     * Discord has no concept of a small image on its own: if the large image is
     * missing it promotes the small one into the big slot. Only set a small image
     * when a large one is actually going out.
     */
    applySmallImage(activity, info, preferredKey, text) {
        if (!activity.largeImageKey) {
            this.warnMissingLargeAsset();
            return;
        }
        const key = (0, discordAppInfo_1.resolveAssetKey)(info, preferredKey, FALLBACK_IMAGE_KEY);
        if (!key) {
            return;
        }
        activity.smallImageKey = key;
        activity.smallImageText = text;
    }
    warnMissingLargeAsset() {
        if (this.warnedMissingLargeAsset) {
            return;
        }
        this.warnedMissingLargeAsset = true;
        log(`No "${LARGE_IMAGE_KEY}" or "${FALLBACK_IMAGE_KEY}" asset is uploaded — sending no images at all, `
            + 'because a small image with no large image gets promoted into the large slot.');
        void vscode.window.showWarningMessage('Null Discord: no Rich Presence art assets found on your Discord application.', 'Show Details').then((action) => {
            if (action === 'Show Details') {
                output.show(true);
            }
        });
    }
    /** Fetched once per application — the result rarely changes mid-session. */
    getAppInfo(clientId) {
        if (this.appInfoClientId !== clientId || !this.appInfoPromise) {
            this.appInfoClientId = clientId;
            this.appInfoPromise = (0, discordAppInfo_1.fetchDiscordAppInfo)(clientId, log);
        }
        return this.appInfoPromise;
    }
    /** Resolved once per workspace — the Git and GitHub lookups are not free. */
    async resolveRepoButton() {
        if (this.repoButtonResolved) {
            return this.repoButton;
        }
        this.repoButtonResolved = true;
        const remote = await gitRemoteUrl();
        let url = NULL_REPO_URL;
        if (remote) {
            // A private repo's link is a 404 for everyone who sees the presence, so
            // fall back to linking Null IDE itself rather than a dead URL.
            const isPublic = await isPublicGitHubRepo(remote);
            if (isPublic === false) {
                log(`Repository ${remote} is private — linking Null IDE instead.`);
            }
            else {
                url = remote;
            }
        }
        this.repoButton = {
            label: buttonLabelForUrl(url).slice(0, BUTTON_LABEL_MAX_LEN),
            url,
        };
        return this.repoButton;
    }
}
exports.DiscordPresenceManager = DiscordPresenceManager;
/** Untitled buffers have no path; show something meaningful instead of "Untitled-1". */
function fileLabel(document) {
    if (document.isUntitled) {
        return 'Untitled file';
    }
    return path.basename(document.fileName);
}
async function gitRemoteUrl() {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (!gitExt) {
        return undefined;
    }
    try {
        const git = gitExt.isActive ? gitExt.exports.getAPI(1) : (await gitExt.activate()).getAPI(1);
        const repo = git.repositories.find((r) => r.ui.selected) ?? git.repositories[0];
        const remotes = repo?.state?.remotes;
        const origin = remotes?.find((r) => r.name === 'origin') ?? remotes?.[0];
        const remote = origin?.fetchUrl ?? origin?.pushUrl;
        if (!remote) {
            return undefined;
        }
        const url = normalizeGitUrl(remote);
        // Discord only accepts http(s) button targets.
        return /^https?:\/\/\S+$/.test(url) ? url : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * True/false for GitHub repositories, `undefined` when we cannot tell (another
 * host, rate limiting, offline) — callers should keep the button in that case.
 */
async function isPublicGitHubRepo(url) {
    const match = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)\/?$/.exec(url);
    if (!match) {
        return undefined;
    }
    try {
        const response = await fetch(`https://api.github.com/repos/${match[1]}/${match[2]}`, {
            signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
            headers: { accept: 'application/vnd.github+json' },
        });
        // Unauthenticated requests cannot see private repos at all — they 404.
        if (response.status === 404) {
            return false;
        }
        if (!response.ok) {
            return undefined;
        }
        const data = await response.json();
        return data.private === false;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=discordPresence.js.map