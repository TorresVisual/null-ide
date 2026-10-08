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
const vscode = __importStar(require("vscode"));
const accountStore_1 = require("./accountStore");
const accountSetup_1 = require("./accountSetup");
const api_1 = require("./api");
const changeEmitter_1 = require("./changeEmitter");
const projectBinding_1 = require("./projectBinding");
const github_1 = require("./providers/github");
const gitlab_1 = require("./providers/gitlab");
const accountPicker_1 = require("./ui/accountPicker");
const accountsMenuActions_1 = require("./ui/accountsMenuActions");
const accountsMenuController_1 = require("./ui/accountsMenuController");
const accountsMenuModel_1 = require("./ui/accountsMenuModel");
const accountsPanel_1 = require("./ui/accountsPanel");
const statusBarController_1 = require("./ui/statusBarController");
const IMPORT_OFFERED_KEY = 'null-accounts.importOffered';
function activate(context) {
    const store = new accountStore_1.AccountStore(context.globalState, context.secrets);
    const bindings = new projectBinding_1.ProjectBinding(context.globalState);
    const github = new github_1.GithubProvider({
        getSession: (scopes, options) => vscode.authentication.getSession('github', scopes, options),
        api: github_1.fetchGithub,
    });
    const gitlab = new gitlab_1.GitlabProvider({
        post: gitlab_1.fetchPostForm,
        get: gitlab_1.fetchGitlab,
        secrets: { get: id => store.getSecret(id), set: (id, value) => store.setSecret(id, value) },
        clientIdFor: host => {
            const cfg = vscode.workspace.getConfiguration('null-accounts.gitlab');
            return (0, gitlab_1.resolveClientId)(host, cfg.get('clientId'), cfg.get('hostClientIds'));
        },
        now: Date.now,
        sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
        onNeedsReauth: account => {
            void vscode.window
                .showWarningMessage(`Your GitLab sign-in for ${account.username}@${account.host} has expired.`, 'Re-authenticate')
                .then(choice => { if (choice) {
                return (0, accountPicker_1.reauthenticate)(pickerDeps, account.id);
            } });
        },
        promptReauth: account => (0, accountPicker_1.reauthenticate)(pickerDeps, account.id),
    });
    // One event for "something changed" (accounts or bindings); the API and, later, the UI listen to it.
    const changed = new changeEmitter_1.ChangeEmitter();
    context.subscriptions.push(store.onDidChange(() => {
        void bindings.prune(new Set(store.list().map(a => a.id)));
        changed.fire();
    }), bindings.onDidChange(() => changed.fire()), gitlab.onDidChange(() => changed.fire()));
    const pickerDeps = { accounts: store, bindings, github, gitlab };
    const api = (0, api_1.createApi)({
        accounts: store,
        accountIdForFolder: folder => bindings.accountIdFor(folder.fsPath),
        chooseAccountForFolder: folder => (0, accountPicker_1.chooseAccountForFolder)(pickerDeps, folder),
        tokenProviders: { github, gitlab },
        onDidChange: changed.event,
    });
    context.subscriptions.push(vscode.commands.registerCommand('null-accounts.open', () => accountsPanel_1.AccountsPanel.createOrShow({
        accounts: store,
        bindings,
        add: () => (0, accountPicker_1.addAccount)(pickerDeps),
        reauth: id => (0, accountPicker_1.reauthenticate)(pickerDeps, id),
        needsReauth: id => gitlab.needsReauth(id),
        onDidChange: changed.event,
    })), vscode.commands.registerCommand(statusBarController_1.SWITCH_COMMAND, async () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            void vscode.window.showInformationMessage('Open a folder to choose its account.');
            return;
        }
        await (0, accountPicker_1.chooseAccountForFolder)(pickerDeps, folder.uri);
    }), vscode.commands.registerCommand(accountsMenuModel_1.BIND_COMMAND, async (accountId) => {
        const result = await (0, accountsMenuActions_1.bindFolderToAccount)({ folderPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, accounts: store, bindings }, accountId);
        if (result === 'no-folder') {
            void vscode.window.showInformationMessage('Open a folder to choose its account.');
        }
        if (result === 'no-account') {
            void vscode.window.showInformationMessage('That account no longer exists.');
        }
    }), vscode.commands.registerCommand(accountsMenuModel_1.ADD_ACCOUNT_COMMAND, async () => { await (0, accountPicker_1.addAccount)(pickerDeps); }), (0, statusBarController_1.registerStatusBar)(api), (0, accountsMenuController_1.registerAccountsMenu)(api));
    if (context.extensionMode === vscode.ExtensionMode.Test) {
        // Integration specs cannot sign in to a provider, so they add and remove accounts through these two commands.
        // Not contributed in package.json and registered only when an extensionTestsPath run hosts the extension:
        // they would otherwise be a prompt-free way to add or delete accounts.
        context.subscriptions.push(vscode.commands.registerCommand('null-accounts.test.addAccount', (account, secret) => store.add(account, secret)), vscode.commands.registerCommand('null-accounts.test.removeAccount', (id) => store.remove(id)));
    }
    void offerImport(context, store, bindings, github).catch(() => { });
    return api;
}
/** Once: offer to keep an already-signed-in GitHub account instead of silently logging existing users out. */
async function offerImport(context, store, bindings, github) {
    if (context.globalState.get(IMPORT_OFFERED_KEY)) {
        return;
    }
    const found = await github.existing().catch(() => undefined);
    if (!found) {
        return;
    } // not signed in, or offline: look again next start
    await context.globalState.update(IMPORT_OFFERED_KEY, true);
    if ((0, accountSetup_1.findAccount)(store.list(), found)) {
        return;
    }
    const choice = await vscode.window.showInformationMessage(`Null IDE now manages GitHub accounts. Import the account you're signed in with (${found.username})?`, 'Import', 'Not now');
    if (choice !== 'Import') {
        return;
    }
    const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
    await (0, accountSetup_1.importExisting)(found, folders, store, bindings);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map