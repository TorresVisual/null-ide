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
exports.registerWidgetsFeature = registerWidgetsFeature;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const dashboardGitStatus_1 = require("../dashboardGitStatus");
const githubApi_1 = require("../github/githubApi");
const githubRemote_1 = require("../github/githubRemote");
const presenceOwnership_1 = require("../presenceOwnership");
const recentProjects_1 = require("../recentProjects");
const updater_1 = require("../updater");
const widgetFetch_1 = require("./widgetFetch");
const widgetRefresher_1 = require("./widgetRefresher");
const widgetSections_1 = require("./widgetSections");
const widgetSetup_1 = require("./widgetSetup");
const widgetStore_1 = require("./widgetStore");
const widgetTypes_1 = require("./widgetTypes");
const accountsApi = () => vscode.extensions.getExtension('null.null-accounts')?.exports;
const gitRemote = (cwd) => new Promise(resolve => (0, child_process_1.execFile)('git', ['remote', 'get-url', 'origin'], { cwd, timeout: 5000 }, (err, out) => {
    const ref = err ? null : (0, githubRemote_1.parseGithubRemote)(out);
    resolve(ref ? `${ref.owner}/${ref.repo}` : null);
}));
const settings = () => {
    const c = vscode.workspace.getConfiguration('null.widgets');
    return { enabled: c.get('enabled', false), repos: (0, widgetTypes_1.parseRepos)(c.get('repos', [])) };
};
function registerWidgetsFeature(context) {
    const supported = process.platform === 'win32';
    const notSupported = () => void vscode.window.showInformationMessage('Desktop widgets are only available on Windows.');
    const out = vscode.window.createOutputChannel('Null Widgets');
    const log = (m) => out.appendLine(m);
    let refresher; // set below; the refresh command may run before (or without) it
    /** Starts the widgets (a second start of a running exe only un-hides hidden widgets): `<install>\null_widgets.exe`. False when this build has no exe. */
    const startWidgets = () => {
        const install = (0, updater_1.findInstall)(context);
        const exe = install && path.join(install.installDir, 'null_widgets.exe');
        if (!exe || !fs.existsSync(exe)) {
            return false;
        }
        const child = (0, child_process_1.spawn)(exe, [], { detached: true, stdio: 'ignore', windowsHide: true, cwd: os.tmpdir(), env: (0, widgetSetup_1.widgetEnv)(process.env) });
        child.once('error', err => log(`could not start null_widgets.exe: ${err.message}`));
        child.unref();
        return true;
    };
    const setup = async () => {
        if (!supported) {
            notSupported();
            return;
        }
        const api = accountsApi();
        const accounts = api?.getAccounts().filter(a => a.provider === 'github') ?? [];
        if (!api || accounts.length === 0) {
            void vscode.window.showWarningMessage('Add a GitHub account first (Null: Accounts), then run Set Up Widgets again.');
            return;
        }
        const account = accounts.length === 1 ? accounts[0]
            : (await vscode.window.showQuickPick(accounts.map(a => ({ label: a.username, description: a.host, a })), { title: 'Widgets: pick an account' }))?.a;
        if (!account) {
            return;
        }
        const token = await api.getToken(account, ['repo'], { interactive: true });
        if (!token) {
            return;
        }
        let names;
        try {
            names = (0, widgetSetup_1.repoChoices)(await (0, githubApi_1.requestJson)('/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member', token));
        }
        catch (err) {
            void vscode.window.showErrorMessage(`Could not list repositories: ${err.message}`);
            return;
        }
        const chosen = new Set(settings().repos.filter(r => r.account === account.id).map(r => r.repo.toLowerCase()));
        const picked = await vscode.window.showQuickPick(names.map(label => ({ label, picked: chosen.has(label.toLowerCase()) })), {
            canPickMany: true, title: 'Widgets: repositories for Issues and Pull Requests',
            placeHolder: 'Private issue and pull request titles will appear on your desktop. Pick none for Projects only.',
        });
        if (!picked) {
            return;
        }
        const cfg = vscode.workspace.getConfiguration('null.widgets');
        await cfg.update('repos', (0, widgetSetup_1.mergeRepos)(settings().repos, account.id, picked.map(p => p.label)), vscode.ConfigurationTarget.Global);
        await cfg.update('enabled', true, vscode.ConfigurationTarget.Global);
        if (startWidgets()) {
            void vscode.window.showInformationMessage('Widgets are set up and shown on your desktop. To start them at every login, tick "Desktop widgets" in Null: Setup.');
        }
        else {
            void vscode.window.showWarningMessage('Widgets are set up, but this Null IDE has no null_widgets.exe. Install or update Null IDE from a release build.');
        }
    };
    context.subscriptions.push(vscode.commands.registerCommand('null.widgets.setup', setup), vscode.commands.registerCommand('null.widgets.refresh', async () => {
        if (!supported) {
            notSupported();
            return;
        }
        if (!settings().enabled) {
            void vscode.window.showInformationMessage('Run "Null: Set Up Widgets" first.');
            return;
        }
        await refresher?.refresh();
    }), out);
    if (!supported) {
        return;
    }
    let dir;
    try {
        dir = (0, widgetStore_1.widgetsDir)();
    }
    catch (err) {
        log(`disabled: ${err.message}`);
        return;
    }
    const store = new widgetStore_1.SnapshotStore(dir);
    const ownership = new presenceOwnership_1.PresenceOwnership(dir, log, 'widgets-owner.json');
    const api = () => accountsApi();
    const live = new widgetRefresher_1.WidgetRefresher({
        now: Date.now,
        settings,
        ownership,
        store,
        fetch: async (accountId, repos) => {
            const a = api();
            const account = a?.getAccounts().find(x => x.id === accountId);
            return (0, widgetFetch_1.fetchRepos)({
                token: async () => (a && account ? a.getToken(account, ['repo'], { interactive: false }) : undefined),
                graphql: (q, v, token) => (0, githubApi_1.requestGraphql)(q, v, token),
                localPaths: () => cachedLocal,
            }, accountId, repos);
        },
        projects: async () => {
            const entries = (0, recentProjects_1.readRecentProjects)((0, recentProjects_1.getRecentProjectsFilePath)());
            const dirs = entries.filter(e => !e.isWorkspaceFile).map(e => e.path);
            const statuses = new Map();
            await (0, dashboardGitStatus_1.computeGitStatuses)(dirs.slice(0, 20), (p, s) => statuses.set(p, s));
            const remotes = new Map();
            await (0, dashboardGitStatus_1.computeGitStatuses)(dirs, (p, r) => remotes.set(p, r), 4, gitRemote);
            cachedLocal = (0, widgetSetup_1.localPathsFrom)(remotes);
            return (0, widgetSections_1.buildProjects)(entries, statuses);
        },
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: h => clearTimeout(h),
        log,
    });
    refresher = live;
    let cachedLocal = new Map();
    live.start();
    context.subscriptions.push(vscode.window.onDidChangeWindowState(s => live.setFocused(s.focused)), vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('null.widgets')) {
        live.onConfigChanged();
    } }), { dispose: () => live.dispose() });
    if (vscode.window.state.focused) {
        live.setFocused(true);
    }
}
//# sourceMappingURL=widgetIntegration.js.map