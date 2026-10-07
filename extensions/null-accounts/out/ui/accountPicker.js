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
const node_path_1 = __importDefault(require("node:path"));
const vscode = __importStar(require("vscode"));
const accountInput_1 = require("../accountInput");
const accountSetup_1 = require("../accountSetup");
const git_1 = require("../git");
const gitlab_1 = require("../providers/gitlab");
const gitlabOAuth_1 = require("../providers/gitlabOAuth");
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
        prompt: 'Create one under Edit profile → Access tokens with the api and write_repository scopes (read_api for read-only).',
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