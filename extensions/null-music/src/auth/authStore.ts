'use strict';

import { MusicAuthToken } from '../types';

export interface SecretVault {
  get(key: string): Thenable<string | undefined> | Promise<string | undefined>;
  store(key: string, value: string): Thenable<void> | Promise<void>;
  delete(key: string): Thenable<void> | Promise<void>;
}

export interface AuthStateListener {
  (providerId: string, token: MusicAuthToken | null): void;
}

export class AuthStore {
  private static readonly KEY_PREFIX = 'null-music/token/';
  private readonly listeners: Set<AuthStateListener> = new Set();

  constructor(private readonly vault: SecretVault) {}

  public onDidChangeAuth(listener: AuthStateListener): { dispose: () => void } {
    this.listeners.add(listener);
    return {
      dispose: () => this.listeners.delete(listener),
    };
  }

  private notify(providerId: string, token: MusicAuthToken | null): void {
    for (const listener of this.listeners) {
      try {
        listener(providerId, token);
      } catch (err) {
        console.error('Error in onDidChangeAuth listener:', err);
      }
    }
  }

  public async getToken(providerId: string): Promise<MusicAuthToken | null> {
    const raw = await this.vault.get(`${AuthStore.KEY_PREFIX}${providerId}`);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as MusicAuthToken;
      if (parsed && typeof parsed.accessToken === 'string' && typeof parsed.expiresAt === 'number') {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  public async setToken(providerId: string, token: MusicAuthToken): Promise<void> {
    const raw = JSON.stringify(token);
    await this.vault.store(`${AuthStore.KEY_PREFIX}${providerId}`, raw);
    this.notify(providerId, token);
  }

  public async clearToken(providerId: string): Promise<void> {
    await this.vault.delete(`${AuthStore.KEY_PREFIX}${providerId}`);
    this.notify(providerId, null);
  }

  public async hasValidToken(providerId: string, bufferMs: number = 60000): Promise<boolean> {
    const token = await this.getToken(providerId);
    if (!token) {
      return false;
    }
    return Date.now() < (token.expiresAt - bufferMs);
  }
}
