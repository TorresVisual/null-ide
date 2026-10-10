'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyGlobalIdentity = applyGlobalIdentity;
const gitPlan_1 = require("./gitPlan");
/**
 * Writes the account's name and email to the user's global git config (the Accounts panel button; nothing else
 * touches global config). Returns the message to show, naming the identity it replaced.
 */
async function applyGlobalIdentity(git, account, cwd) {
    const get = async (key) => (await git(cwd, ['config', '--global', '--get', key])).stdout.trim();
    const [oldName, oldEmail] = [await get('user.name'), await get('user.email')];
    for (const [key, value] of [['user.name', (0, gitPlan_1.gitNameOf)(account)], ['user.email', account.email]]) {
        const result = await git(cwd, ['config', '--global', key, value]);
        if (result.code !== 0) {
            throw new Error(`git config --global ${key} failed: ${result.stderr.trim() || 'is git installed?'}`);
        }
    }
    const was = oldName || oldEmail ? ` (was ${oldName} <${oldEmail}>)` : '';
    return `Global git identity is now ${(0, gitPlan_1.gitNameOf)(account)} <${account.email}>${was}.`;
}
//# sourceMappingURL=globalIdentity.js.map