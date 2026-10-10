'use strict';

export type Provider = 'github' | 'gitlab';
export type AuthMethod = 'oauth' | 'ssh' | 'https';

export interface Account {
  id: string;
  provider: Provider;
  /** Bare lowercase hostname, optional port: "github.com", "gitlab.example.org:8443". */
  host: string;
  username: string;
  email: string;
  /** Author name for commits (`user.name`) when it should differ from the login; defaults to `username`. */
  gitName?: string;
  authMethod: AuthMethod;
  /** Private key git uses over SSH for this account. Required for "ssh" accounts; any other account may have one too. */
  sshKeyPath?: string;
  /** Sign commits in bound repos with `sshKeyPath` (gpg.format=ssh). Only meaningful with a key. */
  signCommits?: boolean;
  /** Provider-side account id (GitHub: the session's `account.id`); used to pick the matching session. */
  externalId?: string;
}

export type NewAccount = Omit<Account, 'id'>;
