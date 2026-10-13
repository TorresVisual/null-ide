'use strict';

import { makeManifest, unlock } from './cryptoBox';
import { GistIo, Snapshot, createGistStore } from './gistStore';
import { MANIFEST } from './layout';
import { Category, FirstSync, StoredState, SyncAccount } from './types';

export const CANCELLED = 'Cancelled.';
const ATTEMPTS = 3;

export interface EnableDeps {
  /** github.com accounts from null-accounts that can have a token. */
  accounts(): Promise<SyncAccount[]>;
  token(accountId: string, interactive: boolean): Promise<string | undefined>;
  io: GistIo;
  /** The categories that will be uploaded, for the consent text. */
  categories(): Category[];
  savePassphrase(passphrase: string): Promise<void>;
  setState(state: StoredState): Promise<void>;
}

export interface EnablePrompts {
  chooseAccount(accounts: SyncAccount[]): Promise<SyncAccount | undefined>;
  consent(categories: Category[]): Promise<boolean>;
  /** Already validated (length, confirmation); `undefined` = cancelled. */
  newPassphrase(): Promise<string | undefined>;
  /** `attempt` starts at 1 so the prompt can say "try again"; `undefined` = cancelled. */
  existingPassphrase(attempt: number): Promise<string | undefined>;
  /** Only asked when the existing store already holds data; `undefined` = cancelled. */
  firstSync(): Promise<FirstSync | 'each' | undefined>;
}

export type EnableResult = { ok: true; firstSync?: FirstSync } | { ok: false; message: string };

const fail = (message: string): EnableResult => ({ ok: false, message });

async function askExisting(prompts: EnablePrompts, snapshot: Snapshot): Promise<string | EnableResult> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const passphrase = await prompts.existingPassphrase(attempt);
    if (!passphrase) return fail(CANCELLED);
    if (await unlock(passphrase, snapshot.files[MANIFEST])) return passphrase;
  }
  return fail('That is not the passphrase for this sync store.');
}

/**
 * Sets this device up: account, consent, then either creates the store (new passphrase) or joins the existing one
 * (its passphrase, plus how to resolve the first sync). Nothing is saved until every step has succeeded.
 */
export async function enable(d: EnableDeps, p: EnablePrompts): Promise<EnableResult> {
  const accounts = await d.accounts();
  if (accounts.length === 0) return fail('Add a GitHub account (github.com) in Null Accounts first.');
  const account = accounts.length === 1 ? accounts[0] : await p.chooseAccount(accounts);
  if (!account) return fail(CANCELLED);
  const token = await d.token(account.id, true);
  if (!token) return fail('GitHub did not provide a token with the gist scope.');
  if (!(await p.consent(d.categories()))) return fail(CANCELLED);

  const store = createGistStore(d.io, token);
  const found = await store.find();
  if (!found.ok) return fail(found.message);

  let snapshot: Snapshot;
  let passphrase: string;
  if (found.value === undefined) {
    const chosen = await p.newPassphrase();
    if (!chosen) return fail(CANCELLED);
    const { manifest } = await makeManifest(chosen);
    const created = await store.create({ [MANIFEST]: JSON.stringify(manifest) });
    if (!created.ok) return fail(created.message);
    snapshot = created.value;
    passphrase = chosen;
  } else {
    const read = await store.read(found.value);
    if (!read.ok) return fail(read.message);
    snapshot = read.value;
    const asked = await askExisting(p, snapshot);
    if (typeof asked !== 'string') return asked;
    passphrase = asked;
  }

  let firstSync: FirstSync | undefined;
  if (found.value !== undefined && Object.keys(snapshot.files).some((name) => name !== MANIFEST)) {
    const choice = await p.firstSync();
    if (!choice) return fail(CANCELLED);
    firstSync = choice === 'each' ? undefined : choice;
  }

  await d.savePassphrase(passphrase);
  await d.setState({ gistId: snapshot.id, accountId: account.id, owner: snapshot.owner, base: {} });
  return { ok: true, firstSync };
}
