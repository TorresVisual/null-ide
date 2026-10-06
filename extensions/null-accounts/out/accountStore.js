'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountStore = exports.ACCOUNTS_KEY = void 0;
const node_crypto_1 = require("node:crypto");
const accountInput_1 = require("./accountInput");
exports.ACCOUNTS_KEY = 'null-accounts.accounts';
const secretKey = (id) => `null-accounts/${id}`;
const PROVIDERS = ['github', 'gitlab'];
const AUTH_METHODS = ['oauth', 'ssh', 'https'];
function isAccount(value) {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const a = value;
    return typeof a.id === 'string'
        && PROVIDERS.includes(a.provider)
        && typeof a.host === 'string'
        && typeof a.username === 'string'
        && typeof a.email === 'string'
        && AUTH_METHODS.includes(a.authMethod);
}
const sameIdentity = (a, b) => a.provider === b.provider && a.host === b.host && a.username.toLowerCase() === b.username.toLowerCase();
class ChangeEmitter {
    listeners = new Set();
    event = listener => {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    };
    fire() {
        for (const listener of [...this.listeners]) {
            try {
                listener();
            }
            catch { /* one bad listener must not break the others or the write that fired it */ }
        }
    }
}
class AccountStore {
    meta;
    secrets;
    newId;
    emitter = new ChangeEmitter();
    onDidChange = this.emitter.event;
    constructor(meta, secrets, newId = node_crypto_1.randomUUID) {
        this.meta = meta;
        this.secrets = secrets;
        this.newId = newId;
    }
    /** Copies of the stored accounts. Unreadable entries are skipped, never thrown on. */
    list() {
        const raw = this.meta.get(exports.ACCOUNTS_KEY);
        return Array.isArray(raw) ? raw.filter(isAccount).map(a => ({ ...a })) : [];
    }
    get(id) {
        return this.list().find(a => a.id === id);
    }
    async add(input, secret) {
        const valid = (0, accountInput_1.validateNewAccount)(input);
        this.assertUnique(valid);
        const account = { id: this.newId(), ...valid };
        // Secret first: the reverse order would leave an account with no token.
        if (secret !== undefined) {
            await this.secrets.store(secretKey(account.id), secret);
        }
        try {
            // Re-check: an overlapping add of the same identity may have landed during the await above.
            this.assertUnique(valid);
            await this.meta.update(exports.ACCOUNTS_KEY, [...this.list(), account]);
        }
        catch (err) {
            if (secret !== undefined) {
                await this.secrets.delete(secretKey(account.id)).then(undefined, () => { });
            }
            throw err;
        }
        this.emitter.fire();
        return { ...account };
    }
    async update(id, patch) {
        const existing = this.get(id);
        if (!existing) {
            throw new Error(`No account with id ${id}`);
        }
        const { id: _id, ...rest } = existing;
        const valid = (0, accountInput_1.validateNewAccount)({ ...rest, ...patch });
        this.assertUnique(valid, id);
        const updated = { id, ...valid };
        await this.meta.update(exports.ACCOUNTS_KEY, this.list().map(a => (a.id === id ? updated : a)));
        this.emitter.fire();
        return { ...updated };
    }
    async remove(id) {
        if (!this.get(id)) {
            return;
        }
        // Secret first: if deleting it fails the account stays listed and removal can be retried.
        await this.secrets.delete(secretKey(id));
        await this.meta.update(exports.ACCOUNTS_KEY, this.list().filter(a => a.id !== id));
        this.emitter.fire();
    }
    getSecret(id) {
        return this.secrets.get(secretKey(id));
    }
    async setSecret(id, value) {
        if (!this.get(id)) {
            throw new Error(`No account with id ${id}`);
        }
        await this.secrets.store(secretKey(id), value);
    }
    assertUnique(candidate, ignoreId) {
        if (this.list().some(a => a.id !== ignoreId && sameIdentity(a, candidate))) {
            throw new Error(`${candidate.username}@${candidate.host} is already added.`);
        }
    }
}
exports.AccountStore = AccountStore;
//# sourceMappingURL=accountStore.js.map