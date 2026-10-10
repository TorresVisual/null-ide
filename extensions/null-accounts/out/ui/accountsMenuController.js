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
exports.registerAccountsMenu = registerAccountsMenu;
const vscode = __importStar(require("vscode"));
const accountsMenuActions_1 = require("./accountsMenuActions");
const accountsMenuModel_1 = require("./accountsMenuModel");
/** Keeps the `null.accounts.menu` context key (rendered by the workbench Accounts menu) in sync with accounts, bindings and the open folder. */
function registerAccountsMenu(api, avatarOf) {
    const setContext = (key, value) => vscode.commands.executeCommand('setContext', key, value);
    const currentId = () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        return folder ? api.getAccountForFolder(folder.uri)?.id : undefined;
    };
    const refresh = () => {
        void (0, accountsMenuActions_1.publishAccountsMenu)(() => (0, accountsMenuModel_1.accountsMenuModel)(api.getAccounts(), currentId(), avatarOf, vscode.workspace.workspaceFolders?.[0]?.name), setContext);
        void setContext(accountsMenuModel_1.AVATAR_CONTEXT_KEY, (0, accountsMenuModel_1.activityAvatar)(api.getAccounts(), currentId(), avatarOf));
    };
    refresh();
    return vscode.Disposable.from(api.onDidChange(refresh), vscode.workspace.onDidChangeWorkspaceFolders(refresh));
}
//# sourceMappingURL=accountsMenuController.js.map