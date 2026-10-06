'use strict';

import { MetadataStore, SecretVault } from './accountStore';

/** In-memory stand-in for vscode.Memento, shared by the unit tests. */
export class FakeMeta implements MetadataStore {
  data = new Map<string, unknown>();
  get<T>(key: string): T | undefined { return this.data.get(key) as T | undefined; }
  async update(key: string, value: unknown): Promise<void> { this.data.set(key, structuredClone(value)); }
}

/** In-memory stand-in for vscode.SecretStorage, shared by the unit tests. */
export class FakeVault implements SecretVault {
  data = new Map<string, string>();
  async get(key: string): Promise<string | undefined> { return this.data.get(key); }
  async store(key: string, value: string): Promise<void> { this.data.set(key, value); }
  async delete(key: string): Promise<void> { this.data.delete(key); }
}
