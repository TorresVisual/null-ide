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
exports.AccountsPanel = void 0;
const node_crypto_1 = require("node:crypto");
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const vscode = __importStar(require("vscode"));
const accountInput_1 = require("../accountInput");
const git_1 = require("../git");
const gitPlan_1 = require("../gitPlan");
const globalIdentity_1 = require("../globalIdentity");
const sshKeyOps_1 = require("../sshKeyOps");
const accountsHtml_1 = require("./accountsHtml");
const accountsView_1 = require("./accountsView");
const keyInfo_1 = require("./keyInfo");
const panelMessages_1 = require("./panelMessages");
/** Real-cased path when the folder exists (binding keys are lower-cased on Windows). */
const resolveFolder = key => {
    try {
        return { path: fs.realpathSync.native(key), exists: true };
    }
    catch {
        return { path: key, exists: false };
    }
};
/** The Accounts tab in the main editor area. One at a time; state is re-posted on every change. */
class AccountsPanel {
    panel;
    deps;
    static current;
    seq = 0;
    static createOrShow(deps) {
        if (AccountsPanel.current) {
            AccountsPanel.current.panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel('null-accounts.panel', 'Null Accounts', vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [] });
        AccountsPanel.current = new AccountsPanel(panel, deps);
    }
    constructor(panel, deps) {
        this.panel = panel;
        this.deps = deps;
        panel.webview.html = (0, accountsHtml_1.buildHtml)((0, node_crypto_1.randomBytes)(16).toString('hex'));
        const changes = deps.onDidChange(() => void this.postState());
        panel.webview.onDidReceiveMessage(raw => void this.handle(raw));
        panel.onDidDispose(() => {
            changes.dispose();
            AccountsPanel.current = undefined;
        });
    }
    async postState() {
        const turn = ++this.seq;
        const accounts = this.deps.accounts.list();
        const keys = await (0, keyInfo_1.describeKeys)(accounts, { home: os.homedir(), exists: fs.existsSync, fingerprintOf: file => (0, sshKeyOps_1.fingerprintOf)(file) });
        if (turn !== this.seq) {
            return;
        } // a newer state is already on its way
        const rows = (0, accountsView_1.buildRows)(accounts, this.deps.bindings.entries(), resolveFolder, id => this.deps.needsReauth(id), keys);
        void this.panel.webview.postMessage({ type: 'state', rows });
    }
    async handle(raw) {
        const msg = (0, panelMessages_1.parsePanelMessage)(raw);
        if (!msg) {
            return;
        }
        try {
            switch (msg.type) {
                case 'ready':
                    await this.postState();
                    break;
                case 'add':
                    await this.deps.add();
                    break; // the store's change event refreshes the list
                case 'reauth':
                    await this.deps.reauth(msg.id);
                    break;
                case 'unbind':
                    await this.deps.bindings.unbind(msg.key);
                    break;
                case 'remove':
                    await this.remove(msg.id);
                    break;
                case 'editName':
                    await this.editName(msg.id);
                    break;
                case 'editEmail':
                    await this.editEmail(msg.id);
                    break;
                case 'setGlobalIdentity':
                    await this.setGlobalIdentity(msg.id);
                    break;
                case 'generateKey':
                    await this.deps.keys.generate(msg.id);
                    break;
                case 'attachKey':
                    await this.deps.keys.attach(msg.id);
                    break;
                case 'copyPublicKey':
                    await this.deps.keys.copyPublic(msg.id);
                    break;
                case 'uploadKey':
                    await this.deps.keys.upload(msg.id);
                    break;
                case 'testKey':
                    await this.deps.keys.test(msg.id);
                    break;
                case 'setSigning':
                    await this.deps.keys.setSigning(msg.id, msg.on);
                    break;
                case 'removeKey':
                    await this.deps.keys.removeKey(msg.id);
                    break;
            }
        }
        catch (err) {
            void vscode.window.showErrorMessage(`Null Accounts: ${err.message}`);
        }
    }
    async remove(id) {
        const account = this.deps.accounts.get(id);
        if (!account) {
            return;
        }
        const used = this.deps.bindings.entries().filter(([, accountId]) => accountId === id).length;
        const { message, detail } = (0, accountsView_1.removeConfirmation)(account, used);
        if (await vscode.window.showWarningMessage(message, { modal: true, detail }, 'Remove') !== 'Remove') {
            return;
        }
        await this.deps.accounts.remove(id); // extension.ts prunes the now-dangling bindings
    }
    async setGlobalIdentity(id) {
        const account = this.deps.accounts.get(id);
        if (!account) {
            return;
        }
        void vscode.window.showInformationMessage(`Null Accounts: ${await (0, globalIdentity_1.applyGlobalIdentity)(git_1.runGit, account, os.tmpdir())}`);
    }
    async editName(id) {
        const account = this.deps.accounts.get(id);
        if (!account) {
            return;
        }
        const name = await vscode.window.showInputBox({
            title: `Git name for ${account.username}`,
            prompt: 'Name on commits in repos bound to this account (git user.name). Leave empty to use the username.',
            value: (0, gitPlan_1.gitNameOf)(account),
        });
        if (name === undefined || name.trim() === (0, gitPlan_1.gitNameOf)(account)) {
            return;
        }
        await this.deps.accounts.update(id, { gitName: name.trim() === account.username ? '' : name }); // empty clears it
    }
    async editEmail(id) {
        const account = this.deps.accounts.get(id);
        if (!account) {
            return;
        }
        const email = await vscode.window.showInputBox({
            title: `Email for ${account.username}`,
            prompt: 'Email address for this account',
            value: account.email,
            validateInput: value => {
                try {
                    (0, accountInput_1.validateNewAccount)({ ...account, email: value });
                    return undefined;
                }
                catch (err) {
                    return err.message;
                }
            },
        });
        if (email === undefined || email.trim() === account.email) {
            return;
        }
        await this.deps.accounts.update(id, { email });
    }
}
exports.AccountsPanel = AccountsPanel;
//# sourceMappingURL=accountsPanel.js.map