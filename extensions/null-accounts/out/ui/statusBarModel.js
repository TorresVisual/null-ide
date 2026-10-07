'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.statusBarModel = statusBarModel;
function statusBarModel(folderName, account) {
    return account
        ? { text: `$(account) ${account.username}`, tooltip: `${folderName} uses ${account.username}@${account.host} — click to switch` }
        : { text: '$(account) No account', tooltip: `${folderName} has no account — click to choose one` };
}
//# sourceMappingURL=statusBarModel.js.map