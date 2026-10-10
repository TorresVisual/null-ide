'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.describeKeys = describeKeys;
const gitPlan_1 = require("../gitPlan");
const sshKey_1 = require("../sshKey");
/** One row per account that has a key. Never rejects: an unreadable key just has no fingerprint. */
async function describeKeys(accounts, deps) {
    const rows = new Map();
    await Promise.all(accounts.filter(a => a.sshKeyPath).map(async (account) => {
        const keyFile = (0, gitPlan_1.sshKeyFile)(account, deps.home);
        const exists = deps.exists(keyFile);
        const fingerprint = exists ? await deps.fingerprintOf(keyFile).catch(() => undefined) : undefined;
        rows.set(account.id, {
            path: account.sshKeyPath,
            exists,
            managed: (0, sshKey_1.isManagedKey)(keyFile, deps.home),
            ...(fingerprint ? { fingerprint } : {}),
            signCommits: account.signCommits === true,
            removable: account.authMethod !== 'ssh',
        });
    }));
    // Promise.all settles in completion order; keep the accounts' own order.
    return new Map(accounts.filter(a => rows.has(a.id)).map(a => [a.id, rows.get(a.id)]));
}
//# sourceMappingURL=keyInfo.js.map