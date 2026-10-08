# Null Accounts — SSH keys (create, manage, push, sign) — Design

Follow-up to [`null-accounts-design.md`](null-accounts-design.md) (issue #102). Phase 6 lets an account point at an *existing* private key (`sshKeyPath` → `core.sshCommand`). This adds the rest of the key's life: creating it, putting its public half on the server, checking it works, signing commits with it, and retiring it.

## Goals

1. Create a key for an account from the Accounts panel (no terminal, no `ssh-keygen` incantations).
2. Show, per account, which key it uses and its fingerprint; copy the public key; test it against the server.
3. Put the public key on GitHub / GitLab in one click when the account has a token; otherwise copy it and open the right settings page.
4. Any account may carry a key, not only SSH-only ones, so one GitHub identity can use HTTPS for the API and SSH for git.
5. Optionally sign commits with the key, per account (`gpg.format=ssh`), repo-local like the rest of the wiring.
6. Detach or delete a key without ever touching a key Null IDE did not create.

## Non-goals

- **ssh-agent / passphrases.** Git runs inside the editor with no terminal, so it cannot ask for a passphrase. Generated keys have none; a user's own passphrase-protected key can still be used for *pushing* (their agent handles it) but cannot be enabled for *signing*.
- Local signature verification (`gpg.ssh.allowedSignersFile`): GitHub and GitLab verify server-side; `git log --show-signature` will say "No principal matched" until the user maintains that file themselves.
- Listing or revoking keys on the server (needs key ids; the user removes the old public key in the provider's settings).
- Hardware keys (`sk-`), RSA/ECDSA generation, tag signing, `~/.ssh/config` host aliases (the per-repo `core.sshCommand` replaces them).
- Switching a repo's `origin` between https and ssh (still a manual `git remote set-url`).

## Decisions

| Decision | Choice | Rejected |
|---|---|---|
| Key type / location | ed25519, no passphrase, `~/.ssh/null-accounts/<host>_<user>_ed25519[_n]`, never overwriting | Passphrase on argv (visible to other processes); keys in `globalStorage` (git needs a plain path; users expect `~/.ssh`) |
| Deleting | Only files inside `~/.ssh/null-accounts/`; anything else is *detached* | Deleting whatever `sshKeyPath` points at |
| Account model | `sshKeyPath` allowed on every account; `signCommits?: boolean`; `authMethod: 'ssh'` still means "no token" | A second `keys` collection per account (one key per account is enough) |
| Signing key reference | `user.signingkey` = the **private** key path | Public key + agent (fails silently when the agent is off, and a failed signature blocks the commit) |
| Enabling signing | Allowed only after a no-prompt test: `ssh-keygen -y -P ""` (rejects passphrase keys) then `ssh-keygen -Y sign` on a temp file | Enabling blindly and failing at commit time |
| Upload | GitHub `POST /user/keys` + `POST /user/ssh_signing_keys` (scopes `write:public_key`, `write:ssh_signing_key`, one consent); GitLab `POST /user/keys` with `usage_type: auth_and_signing` (scope `api`, already in the OAuth flow). "Already added" counts as success | Authentication-only upload (signing would then show "Unverified") |
| Token-less accounts | Copy the public key, open `github.com/settings/ssh/new` or `https://<host>/-/user_settings/ssh_keys` | Asking for a token the account was deliberately created without |
| Replacing a key | New key switches `signCommits` off until re-enabled (the new key is not yet a signing key on the server) | Carrying signing over silently |
| Missing key file on a token account | Identity + credential are still wired; only the SSH settings are left out (an `ssh` account still skips with the existing warning) | Blocking the whole account on an optional key |

## Git wiring additions

| Account state | Extra repo-local config |
|---|---|
| has `sshKeyPath` (any auth method) | `core.sshCommand` (as Phase 6 wrote it for SSH accounts) |
| `signCommits` and `sshKeyPath` | `gpg.format` = `ssh`, `user.signingkey` = key path (`/` separators, `~/` expanded, not shell-quoted), `commit.gpgsign` = `true` |

Everything goes through the existing `GitWiring` reconcile, so previous values (a hand-set `commit.gpgsign=false`) are restored on unbind and a value the user edited afterwards is left alone. Commits made by VS Code's git, the terminal, or null-tools' commit-message generator all pick it up, because it is plain repo config.

## Security

- Private keys are read only by `ssh-keygen`/`ssh`/`git`; the extension never opens them. The public half is read from `<key>.pub` and refused if the text looks like a private key.
- All processes run with `execFile` (argv, no shell), stdin closed, `SSH_ASKPASS_REQUIRE=never` for the signing test.
- The provider token is sent only as an `Authorization` header to the account's own host (`api.github.com` or the GitLab host over HTTPS) and never appears in a message, URL or log.
- Deleting resolves the path first and refuses anything outside the managed directory (including `..` traversal).

## Delivery

One plan: `docs/plans/null-accounts-phase8-ssh-keys.md`. Requires Phase 6 (git wiring, SSH accounts) in the tree.
