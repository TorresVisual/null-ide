'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRows = buildRows;
exports.removeConfirmation = removeConfirmation;
const node_path_1 = __importDefault(require("node:path"));
const gitPlan_1 = require("../gitPlan");
/** Everything the panel shows, as plain data. Deliberately copies display fields only. */
function buildRows(accounts, entries, resolve, needsReauth = () => false, keys = new Map(), avatarOf = () => undefined) {
    return accounts.map(a => ({
        id: a.id,
        provider: a.provider,
        host: a.host,
        username: a.username,
        gitName: (0, gitPlan_1.gitNameOf)(a),
        email: a.email,
        ...(avatarOf(a.id) ? { avatar: avatarOf(a.id) } : {}),
        authMethod: a.authMethod,
        needsReauth: needsReauth(a.id),
        ...(keys.has(a.id) ? { key: keys.get(a.id) } : {}),
        projects: entries
            .filter(([, accountId]) => accountId === a.id)
            .map(([key]) => {
            let resolved;
            try {
                resolved = resolve(key);
            }
            catch {
                resolved = { path: key, exists: false };
            }
            return { key, path: resolved.path, name: node_path_1.default.basename(resolved.path) || resolved.path, exists: resolved.exists };
        })
            .sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' })),
    }));
}
function removeConfirmation(account, projectCount) {
    const used = projectCount === 0
        ? ''
        : `${projectCount} project${projectCount === 1 ? '' : 's'} will lose their account binding. `;
    return {
        message: `Remove ${account.username}@${account.host}?`,
        detail: `${used}This only removes the account from Null IDE; any sign-in kept by VS Code is not affected.`,
    };
}
//# sourceMappingURL=accountsView.js.map