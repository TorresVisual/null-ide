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
exports.activate = activate;
exports.deactivate = deactivate;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const commands_1 = require("./commands");
const extensionHost_1 = require("./extensionHost");
const gistHttp_1 = require("./gistHttp");
const localFiles_1 = require("./localFiles");
const lock_1 = require("./lock");
const syncEngine_1 = require("./syncEngine");
const types_1 = require("./types");
const STATE_KEY = 'null-sync.state';
const PASSPHRASE_KEY = 'null-sync/passphrase';
const STARTUP_MS = 10_000;
const DEBOUNCE_MS = 30_000;
const INTERVAL_MS = 10 * 60_000;
/** Windows paths are case-insensitive (Null IDE is Windows-only). */
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
function activate(context) {
    const config = () => vscode.workspace.getConfiguration('null-sync');
    const storage = context.globalStorageUri.fsPath;
    // `<User>/globalStorage/<publisher.name>` -> `<User>`, where settings.json, keybindings.json and snippets/ live.
    const userDir = path.dirname(path.dirname(storage));
    fs.mkdirSync(storage, { recursive: true });
    const accountsApi = () => vscode.extensions.getExtension('null.null-accounts')?.activate();
    const categories = () => ({
        ...types_1.CATEGORY_DEFAULTS,
        ...config().get('categories'),
    });
    const githubAccounts = async () => ((await accountsApi())?.getAccounts() ?? [])
        .filter((a) => a.provider === 'github' && a.host === 'github.com' && a.authMethod !== 'ssh')
        .map(({ id, username }) => ({ id, username }));
    const token = async (accountId, interactive) => {
        const api = await accountsApi();
        const account = api?.getAccounts().find((a) => a.id === accountId);
        return api && account ? api.getToken(account, ['gist'], { interactive }) : undefined;
    };
    const io = { json: gistHttp_1.fetchJson, text: gistHttp_1.fetchText };
    const files = new localFiles_1.LocalFiles({
        userDir,
        backupsDir: path.join(storage, 'backups'),
        now: Date.now,
        isDirty: (absolutePath) => vscode.workspace.textDocuments.some((doc) => doc.isDirty && samePath(doc.uri.fsPath, absolutePath)),
    });
    const engine = new syncEngine_1.SyncEngine({
        enabled: () => config().get('enabled', false),
        categories,
        excluded: () => config().get('excludedSettings', []),
        accounts: githubAccounts,
        token,
        io,
        files,
        passphrase: async () => context.secrets.get(PASSPHRASE_KEY),
        clearPassphrase: async () => context.secrets.delete(PASSPHRASE_KEY),
        state: { get: () => context.globalState.get(STATE_KEY) },
        setState: async (state) => { await context.globalState.update(STATE_KEY, state); },
        lock: () => (0, lock_1.acquire)(path.join(storage, 'lock')),
        now: Date.now,
        extensions: extensionHost_1.extensionHost,
        confirmOverwrite: async (file) => (await vscode.window.showWarningMessage(`${file} has unsaved changes. Overwrite it with the synced version?`, { modal: true }, 'Overwrite')) === 'Overwrite',
    });
    const enableDeps = {
        accounts: githubAccounts,
        token,
        io,
        categories: () => Object.keys(types_1.CATEGORY_DEFAULTS).filter((category) => categories()[category]),
        savePassphrase: async (passphrase) => { await context.secrets.store(PASSPHRASE_KEY, passphrase); },
        setState: async (state) => { await context.globalState.update(STATE_KEY, state); },
    };
    const changed = new vscode.EventEmitter();
    context.subscriptions.push(changed, engine.onDidChange(() => changed.fire()));
    (0, commands_1.registerCommands)(context, engine, enableDeps, userDir);
    // Background triggers: shortly after startup, after a synced file changes (debounced), and on a timer. None prompt.
    const background = () => void engine.run({ interactive: false });
    let debounce;
    const fileChanged = () => {
        if (debounce)
            clearTimeout(debounce);
        debounce = setTimeout(background, DEBOUNCE_MS);
    };
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(userDir), '{settings.json,keybindings.json,snippets/*}'));
    const startup = setTimeout(background, STARTUP_MS);
    const timer = setInterval(background, INTERVAL_MS);
    context.subscriptions.push(watcher, watcher.onDidChange(fileChanged), watcher.onDidCreate(fileChanged), watcher.onDidDelete(fileChanged), vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('null-sync'))
        background(); }), { dispose: () => { clearTimeout(startup); clearInterval(timer); if (debounce)
            clearTimeout(debounce); } });
    return {
        getStatus: () => engine.getStatus(),
        onDidChangeStatus: changed.event,
        syncNow: () => engine.run({ interactive: true }),
        resolveConflict: (file, side) => engine.resolve(file, side),
        uninstallRemoved: (id) => engine.uninstallRemoved(id),
        syncActivity: (exchange) => engine.syncActivity(exchange),
    };
}
function deactivate() { }
//# sourceMappingURL=extension.js.map