'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthStore = void 0;
class AuthStore {
    vault;
    static KEY_PREFIX = 'null-music/token/';
    listeners = new Set();
    constructor(vault) {
        this.vault = vault;
    }
    onDidChangeAuth(listener) {
        this.listeners.add(listener);
        return {
            dispose: () => this.listeners.delete(listener),
        };
    }
    notify(providerId, token) {
        for (const listener of this.listeners) {
            try {
                listener(providerId, token);
            }
            catch (err) {
                console.error('Error in onDidChangeAuth listener:', err);
            }
        }
    }
    async getToken(providerId) {
        const raw = await this.vault.get(`${AuthStore.KEY_PREFIX}${providerId}`);
        if (!raw) {
            return null;
        }
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.accessToken === 'string' && typeof parsed.expiresAt === 'number') {
                return parsed;
            }
            return null;
        }
        catch {
            return null;
        }
    }
    async setToken(providerId, token) {
        const raw = JSON.stringify(token);
        await this.vault.store(`${AuthStore.KEY_PREFIX}${providerId}`, raw);
        this.notify(providerId, token);
    }
    async clearToken(providerId) {
        await this.vault.delete(`${AuthStore.KEY_PREFIX}${providerId}`);
        this.notify(providerId, null);
    }
    async hasValidToken(providerId, bufferMs = 60000) {
        const token = await this.getToken(providerId);
        if (!token) {
            return false;
        }
        return Date.now() < (token.expiresAt - bufferMs);
    }
}
exports.AuthStore = AuthStore;
//# sourceMappingURL=authStore.js.map