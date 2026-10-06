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
  authMethod: AuthMethod;
  /** Required when authMethod is "ssh"; absent otherwise. */
  sshKeyPath?: string;
  /** Provider-side account id (GitHub: the session's `account.id`); used to pick the matching session. */
  externalId?: string;
}

export type NewAccount = Omit<Account, 'id'>;
