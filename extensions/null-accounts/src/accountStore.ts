'use strict';

import { randomUUID } from 'node:crypto';
import { validateNewAccount } from './accountInput';
import { ChangeEmitter } from './changeEmitter';
import { Account, NewAccount } from './types';

/** The slice of vscode.Memento the store needs, so tests need no VS Code host. */
export interface MetadataStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** The slice of vscode.SecretStorage the store needs. */
export interface SecretVault {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export const ACCOUNTS_KEY = 'null-accounts.accounts';
const secretKey = (id: string): string => `null-accounts/${id}`;

const PROVIDERS = ['github', 'gitlab'];
const AUTH_METHODS = ['oauth', 'ssh', 'https'];

function isAccount(value: unknown): value is Account {
  if (typeof value !== 'object' || value === null) { return false; }
  const a = value as Record<string, unknown>;
  return typeof a.id === 'string'
    && PROVIDERS.includes(a.provider as string)
    && typeof a.host === 'string'
    && typeof a.username === 'string'
    && typeof a.email === 'string'
    && AUTH_METHODS.includes(a.authMethod as string)
    && (a.externalId === undefined || typeof a.externalId === 'string');
}

export const sameIdentity = (a: NewAccount, b: NewAccount): boolean =>
  a.provider === b.provider && a.host === b.host && a.username.toLowerCase() === b.username.toLowerCase();

export class AccountStore {
  private readonly emitter = new ChangeEmitter();
  readonly onDidChange = this.emitter.event;
  private readonly secretEmitter = new ChangeEmitter();
  /** Fires after a stored secret is replaced (token refresh, re-sign-in). `add` and `remove` fire `onDidChange` instead. */
  readonly onDidChangeSecret = this.secretEmitter.event;

  constructor(
    private readonly meta: MetadataStore,
    private readonly secrets: SecretVault,
    private readonly newId: () => string = randomUUID,
  ) {}

  /** Copies of the stored accounts. Unreadable entries are skipped, never thrown on. */
  list(): Account[] {
    const raw = this.meta.get<unknown>(ACCOUNTS_KEY);
    return Array.isArray(raw) ? raw.filter(isAccount).map(a => ({ ...a })) : [];
  }

  get(id: string): Account | undefined {
    return this.list().find(a => a.id === id);
  }

  async add(input: NewAccount, secret?: string): Promise<Account> {
    const valid = validateNewAccount(input);
    this.assertUnique(valid);
    const account: Account = { id: this.newId(), ...valid };
    // Secret first: the reverse order would leave an account with no token.
    if (secret !== undefined) {
      await this.secrets.store(secretKey(account.id), secret);
    }
    try {
      // Re-check: an overlapping add of the same identity may have landed during the await above.
      this.assertUnique(valid);
      await this.meta.update(ACCOUNTS_KEY, [...this.list(), account]);
    } catch (err) {
      if (secret !== undefined) {
        await this.secrets.delete(secretKey(account.id)).then(undefined, () => { /* best effort; surface the original error */ });
      }
      throw err;
    }
    this.emitter.fire();
    return { ...account };
  }

  async update(id: string, patch: Partial<NewAccount>): Promise<Account> {
    const existing = this.get(id);
    if (!existing) { throw new Error(`No account with id ${id}`); }
    const { id: _id, ...rest } = existing;
    const valid = validateNewAccount({ ...rest, ...patch });
    this.assertUnique(valid, id);
    const updated: Account = { id, ...valid };
    await this.meta.update(ACCOUNTS_KEY, this.list().map(a => (a.id === id ? updated : a)));
    this.emitter.fire();
    return { ...updated };
  }

  async remove(id: string): Promise<void> {
    if (!this.get(id)) { return; }
    // Secret first: if deleting it fails the account stays listed and removal can be retried.
    await this.secrets.delete(secretKey(id));
    await this.meta.update(ACCOUNTS_KEY, this.list().filter(a => a.id !== id));
    this.emitter.fire();
  }

  getSecret(id: string): PromiseLike<string | undefined> {
    return this.secrets.get(secretKey(id));
  }

  async setSecret(id: string, value: string): Promise<void> {
    if (!this.get(id)) { throw new Error(`No account with id ${id}`); }
    await this.secrets.store(secretKey(id), value);
    this.secretEmitter.fire();
  }

  private assertUnique(candidate: NewAccount, ignoreId?: string): void {
    if (this.list().some(a => a.id !== ignoreId && sameIdentity(a, candidate))) {
      throw new Error(`${candidate.username}@${candidate.host} is already added.`);
    }
  }
}
