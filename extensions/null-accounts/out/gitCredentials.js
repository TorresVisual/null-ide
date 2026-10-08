'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.CredentialSync = exports.CREDENTIALS_KEY = void 0;
exports.credentialInput = credentialInput;
const git_1 = require("./git");
const gitPlan_1 = require("./gitPlan");
const serial_1 = require("./serial");
exports.CREDENTIALS_KEY = 'null-accounts.gitCredentials';
const sameTarget = (a, b) => a !== undefined && b !== undefined && a.host === b.host && a.username === b.username;
/** The text `git credential approve|reject` reads on stdin; `undefined` if a value could smuggle in another line. */
function credentialInput(target, token) {
    const values = [target.host, target.username, ...(token === undefined ? [] : [token])];
    if (values.some(v => /[\r\n\0]/.test(v))) {
        return undefined;
    }
    return `protocol=https\nhost=${target.host}\nusername=${target.username}\n${token === undefined ? '' : `password=${token}\n`}\n`;
}
/**
 * Keeps the OS credential store (via `git credential approve|reject`) holding the current token of every
 * account that is bound to a folder, so git finds it from any terminal, even with the IDE closed. A credential
 * belongs to the account, not the folder: it is withdrawn only when no folder uses the account any more.
 */
class CredentialSync {
    deps;
    queue = (0, serial_1.serial)();
    /** The token last approved per account, in memory only: a restart approves once more, which is harmless. */
    last = new Map();
    constructor(deps) {
        this.deps = deps;
    }
    sync() {
        return this.queue(async () => {
            const wanted = new Map();
            for (const [, accountId] of this.deps.bindings.entries()) {
                const account = this.deps.accounts.get(accountId);
                const target = account && (0, gitPlan_1.credentialFor)(account);
                if (account && target) {
                    wanted.set(account.id, { account, target });
                }
            }
            let approved = this.approved();
            for (const [id, target] of Object.entries(approved)) {
                if (sameTarget(wanted.get(id)?.target, target)) {
                    continue;
                }
                const res = await this.run('reject', target);
                if (res?.code === git_1.GIT_UNAVAILABLE) {
                    continue;
                } // keep the record; withdraw it once git is back
                const { [id]: _withdrawn, ...rest } = approved;
                approved = rest;
                this.last.delete(id);
                await this.deps.meta.update(exports.CREDENTIALS_KEY, approved);
            }
            for (const [id, { account, target }] of wanted) {
                const token = await this.deps.token(account);
                if (!token) {
                    continue;
                } // signed out or offline: leave whatever is stored, never prompt from here
                if (this.last.get(id) === token && sameTarget(approved[id], target)) {
                    continue;
                }
                const res = await this.run('approve', target, token);
                if (res?.code !== 0) {
                    continue;
                } // retried on the next sync
                this.last.set(id, token);
                approved = { ...approved, [id]: target };
                await this.deps.meta.update(exports.CREDENTIALS_KEY, approved);
            }
        });
    }
    run(verb, target, token) {
        const input = credentialInput(target, token);
        // Token and input go over stdin only: never into an argument, a log line or an error message.
        return input === undefined ? undefined : this.deps.git(this.deps.cwd, ['credential', verb], input);
    }
    approved() {
        const raw = this.deps.meta.get(exports.CREDENTIALS_KEY);
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            return {};
        }
        const isTarget = (v) => typeof v === 'object' && v !== null && typeof v.host === 'string' && typeof v.username === 'string';
        return Object.fromEntries(Object.entries(raw).filter((e) => isTarget(e[1])));
    }
}
exports.CredentialSync = CredentialSync;
//# sourceMappingURL=gitCredentials.js.map