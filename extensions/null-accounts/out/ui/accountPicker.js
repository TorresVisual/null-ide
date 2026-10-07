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
exports.addGithubAccount = addGithubAccount;
exports.chooseAccountForFolder = chooseAccountForFolder;
const node_path_1 = __importDefault(require("node:path"));
const vscode = __importStar(require("vscode"));
const accountSetup_1 = require("../accountSetup");
const git_1 = require("../git");
const suggest_1 = require("../suggest");
const pickItems_1 = require("./pickItems");
/** Signs in to another GitHub account and stores it; resolves the stored one if it was already added. */
async function addGithubAccount(deps) {
    try {
        const fresh = await deps.github.signIn();
        return fresh ? await (0, accountSetup_1.addOrReuse)(deps.accounts, fresh) : undefined;
    }
    catch (err) {
        void vscode.window.showErrorMessage(`Could not add the GitHub account: ${err.message}`);
        return undefined;
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
    const account = picked.action.kind === 'add' ? await addGithubAccount(deps) : picked.action.account;
    if (!account) {
        return undefined;
    }
    await deps.bindings.bind(folder.fsPath, account.id);
    return account;
}
//# sourceMappingURL=accountPicker.js.map