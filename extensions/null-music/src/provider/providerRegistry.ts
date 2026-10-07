'use strict';

import { IMusicProvider } from './musicProvider';

export class ProviderRegistry {
  private readonly providers = new Map<string, IMusicProvider>();
  private activeProviderId: string = 'spotify';
  private readonly listeners = new Set<(provider: IMusicProvider | null) => void>();

  public register(provider: IMusicProvider): { dispose: () => void } {
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

  public get(id: string): IMusicProvider | undefined {
    return this.providers.get(id);
  }

  public getAll(): IMusicProvider[] {
    return Array.from(this.providers.values());
  }

  public getActiveProvider(): IMusicProvider | null {
    return this.providers.get(this.activeProviderId) ?? null;
  }

  public setActiveProviderId(id: string): void {
    if (this.activeProviderId !== id) {
      this.activeProviderId = id;
      this.notify();
    }
  }

  public onDidChangeActiveProvider(listener: (provider: IMusicProvider | null) => void): { dispose: () => void } {
    this.listeners.add(listener);
    return {
      dispose: () => this.listeners.delete(listener),
    };
  }

  private notify(): void {
    const active = this.getActiveProvider();
    for (const listener of this.listeners) {
      try {
        listener(active);
      } catch (err) {
        console.error('Error in onDidChangeActiveProvider listener:', err);
      }
    }
  }
}
