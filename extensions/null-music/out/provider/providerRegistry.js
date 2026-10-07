'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderRegistry = void 0;
class ProviderRegistry {
    providers = new Map();
    activeProviderId = 'spotify';
    listeners = new Set();
    register(provider) {
        this.providers.set(provider.id, provider);
        if (this.activeProviderId === provider.id) {
            this.notify();
        }
        return {
            dispose: () => {
                this.providers.delete(provider.id);
                if (this.activeProviderId === provider.id) {
                    this.notify();
                }
            },
        };
    }
    get(id) {
        return this.providers.get(id);
    }
    getAll() {
        return Array.from(this.providers.values());
    }
    getActiveProvider() {
        return this.providers.get(this.activeProviderId) ?? null;
    }
    setActiveProviderId(id) {
        if (this.activeProviderId !== id) {
            this.activeProviderId = id;
            this.notify();
        }
    }
    onDidChangeActiveProvider(listener) {
        this.listeners.add(listener);
        return {
            dispose: () => this.listeners.delete(listener),
        };
    }
    notify() {
        const active = this.getActiveProvider();
        for (const listener of this.listeners) {
            try {
                listener(active);
            }
            catch (err) {
                console.error('Error in onDidChangeActiveProvider listener:', err);
            }
        }
    }
}
exports.ProviderRegistry = ProviderRegistry;
//# sourceMappingURL=providerRegistry.js.map