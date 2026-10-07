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
    // One event for "something changed" (accounts or bindings); the API and, later, the UI listen to it.
    const changed = new changeEmitter_1.ChangeEmitter();
    context.subscriptions.push(store.onDidChange(() => {
        void bindings.prune(new Set(store.list().map(a => a.id)));
        changed.fire();
    }), bindings.onDidChange(() => changed.fire()));
    const pickerDeps = { accounts: store, bindings, github };
    const api = (0, api_1.createApi)({
        accounts: store,
        accountIdForFolder: folder => bindings.accountIdFor(folder.fsPath),
        chooseAccountForFolder: folder => (0, accountPicker_1.chooseAccountForFolder)(pickerDeps, folder),
        tokenProviders: { github }, // Phase 4 adds gitlab
        onDidChange: changed.event,
    });
    context.subscriptions.push(vscode.commands.registerCommand('null-accounts.open', () => accountsPanel_1.AccountsPanel.createOrShow({
        accounts: store,
        bindings,
        addGithub: () => (0, accountPicker_1.addGithubAccount)(pickerDeps),
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
    }), vscode.commands.registerCommand(accountsMenuModel_1.ADD_ACCOUNT_COMMAND, async () => { await (0, accountPicker_1.addGithubAccount)(pickerDeps); }), (0, statusBarController_1.registerStatusBar)(api), (0, accountsMenuController_1.registerAccountsMenu)(api));
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