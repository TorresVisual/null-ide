'use strict';

import { Account } from './types';

export interface ConfigEntry { key: string; value: string }

/** The OS credential-store entry git looks up for a host + username. */
export interface CredentialTarget { host: string; username: string }

export interface WiringPlan {
  /** Repo-local git config (`git config --local`) to apply, in order. */
  config: ConfigEntry[];
  /** Present for token-based accounts; SSH accounts authenticate with their key instead. */
  credential?: CredentialTarget;
}

/** "~/.ssh/id" -> "<home>/.ssh/id"; backslashes become slashes (git runs `core.sshCommand` through a POSIX shell). */
export function expandKeyPath(raw: string, home: string): string {
  const trimmed = raw.trim();
  const expanded = /^~[\\/]/.test(trimmed) ? `${home.replace(/[\\/]+$/, '')}/${trimmed.slice(2)}` : trimmed;
  return expanded.replace(/\\/g, '/');
}

export const sshKeyFile = (account: Account, home: string): string => expandKeyPath(account.sshKeyPath ?? '', home);

/** The credential entry for a token account (GitHub OAuth, GitLab OAuth or access token); SSH accounts have none. */
export function credentialFor(account: Account): CredentialTarget | undefined {
  return account.authMethod === 'ssh' ? undefined : { host: account.host, username: account.username };
}

// Single quotes: the shell expands nothing inside them, so a key path can't smuggle in a command.
const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

export function planFor(account: Account, home: string): WiringPlan {
  const config: ConfigEntry[] = [
    { key: 'user.name', value: account.username },
    { key: 'user.email', value: account.email },
  ];
  const keyFile = sshKeyFile(account, home);
  if (keyFile) {
    config.push({ key: 'core.sshCommand', value: `ssh -i ${shellQuote(keyFile)} -o IdentitiesOnly=yes` });
    if (account.signCommits) {
      // The private key's path: ssh-keygen signs with it directly, so no agent has to be running.
      // Git reads this value itself (no shell), so it is not quoted.
      config.push(
        { key: 'gpg.format', value: 'ssh' },
        { key: 'user.signingkey', value: keyFile },
        { key: 'commit.gpgsign', value: 'true' },
      );
    }
  }
  if (account.authMethod === 'ssh') { return { config }; }
  // The URL form of the key is the documented one and scopes the username to https remotes on this host.
  config.push({ key: `credential.https://${account.host}.username`, value: account.username });
  return { config, credential: credentialFor(account) };
}
