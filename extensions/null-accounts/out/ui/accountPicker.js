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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addAccount = addAccount;
exports.reauthenticate = reauthenticate;
exports.chooseAccountForFolder = chooseAccountForFolder;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const vscode = __importStar(require("vscode"));
const accountInput_1 = require("../accountInput");
const accountSetup_1 = require("../accountSetup");
const git_1 = require("../git");
const gitlab_1 = require("../providers/gitlab");
const gitlabOAuth_1 = require("../providers/gitlabOAuth");
const sshAccount_1 = require("../sshAccount");
const sshKeyOps_1 = require("../sshKeyOps");
const suggest_1 = require("../suggest");
const pickItems_1 = require("./pickItems");
function reportFailure(what, err) {
    if (err instanceof gitlabOAuth_1.OAuthError && err.reason === 'cancelled') {
        return;
    }
    void vscode.window.showErrorMessage(`Could not ${what}: ${err.message}`);
}
/** Signs in to another GitHub account and stores it; resolves the stored one if it was already added. */
async function addGithubAccount(deps) {
    try {
        const fresh = await deps.github.signIn();
        return fresh ? await (0, accountSetup_1.addOrReuse)(deps.accounts, fresh) : undefined;
    }
    catch (err) {
        reportFailure('add the GitHub account', err);
        return undefined;
    }
}
/** A device-flow sign-in behind a cancellable notification: shows the code, copies it, opens the verification page. */
function withDeviceFlow(title, run) {
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true }, (progress, token) => run({
        show: code => {
            progress.report({ message: `Enter ${code.userCode} in your browser (copied to the clipboard)` });
            void vscode.env.clipboard.writeText(code.userCode);
            void vscode.env.openExternal(vscode.Uri.parse(code.verificationUriComplete ?? code.verificationUri));
        },
        cancelled: () => token.isCancellationRequested,
    }));
}
async function addGitlabAccount(deps, host) {
    try {
        const { account, secret } = await withDeviceFlow(`Signing in to ${host}`, ui => deps.gitlab.signIn(host, ui));
        return await (0, accountSetup_1.addOrRefresh)(deps.accounts, account, secret);
    }
    catch (err) {
        reportFailure('add the GitLab account', err);
        return undefined;
    }
}
async function askSelfHostedHost(title = 'Self-hosted GitLab') {
    const value = await vscode.window.showInputBox({
        title,
        prompt: 'Host name of your GitLab server, e.g. git.example.org (https only)',
        validateInput: v => { try {
            (0, accountInput_1.normalizeHost)(v);
            return undefined;
        }
        catch (err) {
            return err.message;
        } },
    });
    return value === undefined ? undefined : (0, accountInput_1.normalizeHost)(value);
}
/** A personal access token for a server where no OAuth app can be registered; adding the same account again replaces its token. */
async function addGitlabTokenAccount(deps) {
    const host = await askSelfHostedHost('GitLab host for the access token');
    if (!host) {
        return undefined;
    }
    const token = await vscode.window.showInputBox({
        title: `Access token for ${host}`,
        prompt: 'Create one under Edit profile → Access tokens with the api and write_repository scopes (read_api for read-only). If the server requires fine-grained tokens, include the User: Read permission.',
        password: true,
        ignoreFocusOut: true,
    });
    if (!token) {
        return undefined;
    }
    try {
        const { account, secret } = await deps.gitlab.signInWithToken(host, token);
        return await (0, accountSetup_1.addOrRefresh)(deps.accounts, account, secret);
    }
    catch (err) {
        reportFailure('add the GitLab account', err);
        return undefined;
    }
}
const problemOf = (check) => (value) => {
    try {
        check(value);
        return undefined;
    }
    catch (err) {
        return err.message;
    }
};
/** An account that signs in with an SSH key only: no OAuth, no token. Asks for the server, who you are there, and the key file. */
async function addSshAccount(deps) {
    const host = await vscode.window.showInputBox({
        title: 'SSH account: server',
        prompt: 'Host name of the GitLab (or GitHub) server, e.g. gitlab.example.edu — no port',
        validateInput: problemOf(sshAccount_1.normalizeSshHost),
        ignoreFocusOut: true,
    });
    if (host === undefined) {
        return undefined;
    }
    const username = await vscode.window.showInputBox({
        title: `Your username on ${(0, sshAccount_1.normalizeSshHost)(host)}`,
        prompt: 'The name shown on your profile there (it is also used as the git author name)',
        validateInput: v => (v.trim() ? undefined : 'A username is required.'),
        ignoreFocusOut: true,
    });
    if (username === undefined) {
        return undefined;
    }
    const email = await vscode.window.showInputBox({
        title: 'Email for commits',
        prompt: 'Written to user.email in projects that use this account',
        validateInput: problemOf(v => (0, accountInput_1.validateNewAccount)({ provider: 'gitlab', host: 'x.example', username: 'x', email: v, authMethod: 'oauth' })),
        ignoreFocusOut: true,
    });
    if (email === undefined) {
        return undefined;
    }
    const mode = await vscode.window.showQuickPick([
        { label: '$(key) Generate a new key', description: 'recommended — no passphrase, kept in ~/.ssh/null-accounts', generate: true },
        { label: '$(file) Use an existing key…', description: 'a private key file you already have', generate: false },
    ], { placeHolder: 'Which SSH key should this account use?', ignoreFocusOut: true });
    if (!mode) {
        return undefined;
    }
    let keyPath;
    if (mode.generate) {
        try {
            keyPath = await (0, sshKeyOps_1.generateKey)({ home: os.homedir(), host: (0, sshAccount_1.normalizeSshHost)(host), username: username.trim(), email: email.trim() });
        }
        catch (err) {
            reportFailure('create the SSH key', err);
            return undefined;
        }
    }
    else {
        const picked = await vscode.window.showOpenDialog({
            title: `Private SSH key for ${(0, sshAccount_1.normalizeSshHost)(host)}`,
            openLabel: 'Use this key',
            canSelectMany: false,
            canSelectFolders: false,
            defaultUri: vscode.Uri.file(node_path_1.default.join(os.homedir(), '.ssh')),
        });
        if (!picked?.length) {
            return undefined;
        }
        keyPath = picked[0].fsPath;
    }
    try {
        const account = await deps.accounts.add((0, sshAccount_1.buildSshAccount)({ host, username, email, keyPath }, os.homedir(), fs.existsSync));
        // A new key is not on the server yet, so testing it now would only fail: offer to put it there first.
        const next = mode.generate ? deps.keys.afterNewKey(account.id) : deps.keys.test(account.id);
        void next.catch(err => reportFailure('finish setting up the key', err));
        return account;
    }
    catch (err) {
        reportFailure('add the SSH account', err);
        return undefined;
    }
}
/** Asks which provider, then signs in and stores the account. `undefined` if the user backs out or sign-in fails. */
async function addAccount(deps) {
    const picked = await vscode.window.showQuickPick((0, pickItems_1.providerPickItems)(), { placeHolder: 'Add an account from…' });
    if (!picked) {
        return undefined;
    }
    if (picked.choice === 'github') {
        return addGithubAccount(deps);
    }
    if (picked.choice === 'gitlab-token') {
        return addGitlabTokenAccount(deps);
    }
    if (picked.choice === 'ssh') {
        return addSshAccount(deps);
    }
    const host = picked.choice === 'gitlab' ? gitlab_1.GITLAB_COM : await askSelfHostedHost();
    return host ? addGitlabAccount(deps, host) : undefined;
}
/** Signs a GitLab account in again (expired or revoked tokens). Failures are shown, never thrown. */
async function reauthenticate(deps, accountId) {
    const account = deps.accounts.get(accountId);
    if (!account || account.provider !== 'gitlab' || account.authMethod !== 'oauth') {
        return;
    }
    try {
        await withDeviceFlow(`Signing in to ${account.host}`, ui => deps.gitlab.reauthenticate(account, ui));
    }
    catch (err) {
        reportFailure('re-authenticate', err);
    }
}
/** Quick-pick an account for the folder (suggesting one from its origin remote when unbound), then bind it. */
async function chooseAccountForFolder(deps, folder) {
    const currentId = deps.bindings.accountIdFor(folder.fsPath);
    let suggestedId;
    if (currentId === undefined) {
        const origin = await (0, git_1.originUrl)(folder.fsPath);
        suggestedId = origin ? (0, suggest_1.suggestAccount)(origin, deps.accounts.list())?.id : undefined;
    }
    const picked = await vscode.window.showQuickPick((0, pickItems_1.buildPickItems)(deps.accounts.list(), { suggestedId, currentId }), { placeHolder: `Which account should "${node_path_1.default.basename(folder.fsPath)}" use?` });
    if (!picked) {
        return undefined;
    }
    if (picked.action.kind === 'unbind') {
        await deps.bindings.unbind(folder.fsPath);
        return undefined;
    }
    const account = picked.action.kind === 'add' ? await addAccount(deps) : picked.action.account;
    if (!account) {
        return undefined;
    }
    await deps.bindings.bind(folder.fsPath, account.id);
    return account;
}
//# sourceMappingURL=accountPicker.js.map