'use strict';

import { MetadataStore } from './accountStore';
import { GIT_UNAVAILABLE, GitResult, GitRun } from './git';
import { credentialFor, CredentialTarget } from './gitPlan';
import { serial } from './serial';
import { Account } from './types';

export const CREDENTIALS_KEY = 'null-accounts.gitCredentials';

export interface CredentialDeps {
  /** Holds which account's credential we put in the OS store, so it can be withdrawn later. Never a token. */
  meta: MetadataStore;
  git: GitRun;
  /** [folder key, account id] pairs (`ProjectBinding.entries`). */
  bindings: { entries(): [string, string][] };
  accounts: { get(id: string): Account | undefined };
  /** A token without any prompt (`NullAccountsApi.getToken` without `interactive`). */
  token(account: Account): Promise<string | undefined>;
  /** A directory to run `git credential` in; it needs no repo. */
  cwd: string;
}

const sameTarget = (a?: CredentialTarget, b?: CredentialTarget): boolean =>
  a !== undefined && b !== undefined && a.host === b.host && a.username === b.username;

/** The text `git credential approve|reject` reads on stdin; `undefined` if a value could smuggle in another line. */
export function credentialInput(target: CredentialTarget, token?: string): string | undefined {
  const values = [target.host, target.username, ...(token === undefined ? [] : [token])];
  if (values.some(v => /[\r\n\0]/.test(v))) { return undefined; }
  return `protocol=https\nhost=${target.host}\nusername=${target.username}\n${token === undefined ? '' : `password=${token}\n`}\n`;
}

/**
 * Keeps the OS credential store (via `git credential approve|reject`) holding the current token of every
 * account that is bound to a folder, so git finds it from any terminal, even with the IDE closed. A credential
 * belongs to the account, not the folder: it is withdrawn only when no folder uses the account any more.
 */
export class CredentialSync {
  private readonly queue = serial();
  /** The token last approved per account, in memory only: a restart approves once more, which is harmless. */
  private readonly last = new Map<string, string>();

  constructor(private readonly deps: CredentialDeps) {}

  sync(): Promise<void> {
    return this.queue(async () => {
      const wanted = new Map<string, { account: Account; target: CredentialTarget }>();
      for (const [, accountId] of this.deps.bindings.entries()) {
        const account = this.deps.accounts.get(accountId);
        const target = account && credentialFor(account);
        if (account && target) { wanted.set(account.id, { account, target }); }
      }

      let approved = this.approved();
      for (const [id, target] of Object.entries(approved)) {
        if (sameTarget(wanted.get(id)?.target, target)) { continue; }
        const res = await this.run('reject', target);
        if (res?.code === GIT_UNAVAILABLE) { continue; } // keep the record; withdraw it once git is back
        const { [id]: _withdrawn, ...rest } = approved;
        approved = rest;
        this.last.delete(id);
        await this.deps.meta.update(CREDENTIALS_KEY, approved);
      }

      for (const [id, { account, target }] of wanted) {
        const token = await this.deps.token(account);
        if (!token) { continue; } // signed out or offline: leave whatever is stored, never prompt from here
        if (this.last.get(id) === token && sameTarget(approved[id], target)) { continue; }
        const res = await this.run('approve', target, token);
        if (res?.code !== 0) { continue; } // retried on the next sync
        this.last.set(id, token);
        approved = { ...approved, [id]: target };
        await this.deps.meta.update(CREDENTIALS_KEY, approved);
      }
    });
  }

  private run(verb: 'approve' | 'reject', target: CredentialTarget, token?: string): Promise<GitResult> | undefined {
    const input = credentialInput(target, token);
    // Token and input go over stdin only: never into an argument, a log line or an error message.
    return input === undefined ? undefined : this.deps.git(this.deps.cwd, ['credential', verb], input);
  }

  private approved(): Record<string, CredentialTarget> {
    const raw = this.deps.meta.get<unknown>(CREDENTIALS_KEY);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { return {}; }
    const isTarget = (v: unknown): v is CredentialTarget =>
      typeof v === 'object' && v !== null && typeof (v as CredentialTarget).host === 'string' && typeof (v as CredentialTarget).username === 'string';
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, CredentialTarget] => isTarget(e[1])));
  }
}
