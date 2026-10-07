# Null Accounts — Phase 5: GitLab Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Let users add GitLab accounts (gitlab.com and self-hosted) through an OAuth device flow, keep their tokens fresh, flag an account "needs re-auth" when its sign-in dies, and serve those tokens through the existing `NullAccountsApi.getToken`.

**Architecture:** Same split as Phases 1–4: everything with branches is a node-testable module that never imports `vscode` at runtime. `providers/gitlabOAuth.ts` is the protocol (device-code request, polling, refresh, token (de)serialisation) over an injected `post`; `providers/gitlab.ts` is `GitlabProvider` (sign-in, `getToken` with single-flight refresh, the in-memory "needs re-auth" set) over injected `post` / `get` / secrets / clock. Only `ui/accountPicker.ts`, `ui/accountsPanel.ts` and `extension.ts` touch `vscode`. Tokens are stored as one JSON string in `SecretStorage` under the existing `null-accounts/<id>` key, so `AccountStore` does not change.

**Tech Stack:** TypeScript (strict), global `fetch` (Node 22 / Electron), `node --test` + `node:assert`, VS Code `withProgress` / `env.openExternal` / `env.clipboard`.

**Spec:** `docs/specs/null-accounts-design.md` (issue #102), sections "providers/gitlab", "Error handling", "Security" and "Delivery phases". This is plan 5 of 7: (1) Foundation, (2) GitHub + binding, (3) UI, (4) Accounts menu — all landed (`docs/plans/null-accounts-phase{1,2,3,4}-*.md`); (5) GitLab ← this plan; (6) Git wiring; (7) Integration.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [ ] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [ ] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Phase 1–4 constraints still hold: every `.ts` file starts with `'use strict';`; unit-tested modules do not import `vscode` at runtime (`import type` is fine); secrets only in `SecretStorage` and never logged; edit TypeScript sources only — `extensions/null-accounts/out/` is tracked but regenerated with `npm run compile` and committed alone in a `chore: refresh null-accounts compiled output` commit; commit after each task, message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; do not push.
- Run tests with `npm --prefix extensions/null-accounts test` (it runs `tsc` first, then `node --test` over the files listed in `scripts.test`; a new test file must be appended to that list in the task that creates it).
- GitLab OAuth **device flow only**, public client (no secret, ever). Endpoints: `POST https://<host>/oauth/authorize_device` (`client_id`, `scope`), `POST https://<host>/oauth/token` (`grant_type=urn:ietf:params:oauth:grant-type:device_code` + `device_code` + `client_id`; refresh: `grant_type=refresh_token` + `refresh_token` + `client_id`), `GET https://<host>/api/v4/user`. Poll errors: `authorization_pending` (keep going), `slow_down` (interval += 5 s), `access_denied`, `expired_token`.
- Scopes, verbatim from the spec: `read_user api write_repository`.
- Hosts are https only and bare lowercase (`normalizeHost` from `accountInput.ts` is the single gate; it already rejects `http://`). A host may carry a port (`git.example.org:8443`). `Account.host` for the default is `gitlab.com`.
- `getToken` never throws for auth failure (the API already wraps it) and is **silent unless `interactive`**. GitLab scopes are fixed at sign-in, so the `scopes` argument is ignored.
- Tokens expire in ~2 h. A token inside `EXPIRY_MARGIN_MS` (60 s) of expiry counts as expired.
- Client IDs are public but come from settings: `null-accounts.gitlab.clientId` (gitlab.com) and `null-accounts.gitlab.hostClientIds` (`{ "<host>": "<id>" }`, self-hosted). **Deviation from the spec**, which names only the single setting: an OAuth application is registered per GitLab instance, so a self-hosted host cannot reuse gitlab.com's ID. Both settings use `"scope": "application"` so a workspace's `.vscode/settings.json` cannot point sign-in at someone else's OAuth app.
- The default for `null-accounts.gitlab.clientId` is `""` until the Null IDE OAuth application is registered (Task 7, a human step — it needs a GitLab login). With no ID configured, sign-in fails fast with a message naming the setting; nothing else breaks.
- Not in this phase: git config / credential wiring (Phase 6 — a GitLab account can be bound to a project but does not change git behaviour yet), the dashboard showing accounts (Phase 7), a GitLab backend for Issues / MRs, PAT or SSH-only GitLab accounts, signing out on the GitLab side when an account is removed.

## Review Focus

Inputs the spec implies but doesn't spell out, most likely to bite first. Each has a test in the owning task.

1. **Two token requests at once with an expired token** — GitLab rotates the refresh token, so a second parallel refresh would send the already-spent one, get rejected, and wrongly flag the account "needs re-auth". One refresh per account at a time; both callers get the same new token. (Task 2)
2. **Offline, timeout or a 5xx during refresh** — returns `undefined`, does **not** flag re-auth, does not touch the stored tokens; the next call tries again. Only a 400/401 from the token endpoint counts as "the server refused this sign-in". (Tasks 1, 2)
3. **A device-flow response with a non-https verification URL or missing fields** (a hostile or misconfigured self-hosted server) — refused before anything is opened in the browser. (Task 1)
4. **Re-authenticating as a different GitLab user than the account** (browser still signed in as someone else) — refused with a message; the stored tokens are not replaced. (Task 2)
5. **A workspace setting overriding the client ID** — pinned by a test that both settings are `application`-scoped. (Task 5)

---

### Task 1: OAuth protocol (`gitlabOAuth.ts`)

**Files:**
- Create: `extensions/null-accounts/src/providers/gitlabOAuth.ts`
- Test: `extensions/null-accounts/src/providers/gitlabOAuth.test.ts`
- Modify: `extensions/null-accounts/src/testFakes.ts` (add `Reply`, `fakePost`, `fakeClock`)
- Modify: `extensions/null-accounts/package.json` (`scripts.test`)

**Interfaces:**
- Consumes: nothing.
- Produces (Tasks 2–5 import these exact names):
  - `GITLAB_SCOPES: string`, `EXPIRY_MARGIN_MS: number`
  - `interface FormResponse { status: number; body: unknown }`
  - `type PostForm = (url: string, form: Record<string, string>) => Promise<FormResponse>` — resolves any HTTP response, rejects only on network failure
  - `interface DeviceCode { deviceCode: string; userCode: string; verificationUri: string; verificationUriComplete?: string; expiresIn: number; interval: number }`
  - `interface TokenSet { accessToken: string; refreshToken?: string; expiresAt?: number }` (`expiresAt` epoch ms; absent = does not expire)
  - `type OAuthFailure = 'denied' | 'expired' | 'cancelled' | 'rejected' | 'failed'`; `class OAuthError extends Error { readonly reason: OAuthFailure }`
  - `startDeviceFlow(post: PostForm, host: string, clientId: string): Promise<DeviceCode>`
  - `pollForToken(post, host, clientId, code: DeviceCode, opts: { sleep(ms: number): Promise<void>; now(): number; cancelled(): boolean }): Promise<TokenSet>`
  - `refreshTokens(post, host, clientId, refreshToken: string, now: () => number): Promise<TokenSet>`
  - `serializeTokens(t: TokenSet): string`, `parseTokens(raw: string | undefined): TokenSet | undefined`
  - `asRecord(v: unknown): Record<string, unknown>`, `str(v: unknown): string | undefined` (non-empty string or `undefined`)
  - test helpers in `testFakes.ts`: `interface Reply { status?: number; body: unknown }`, `fakePost(...replies: Reply[]): { post: PostForm; calls: Array<{ url: string; form: Record<string, string> }> }` (throws `unexpected extra request` when the queue is empty), `fakeClock(): { now(): number; sleep(ms: number): Promise<void>; slept: number[] }` (starts at `1_000_000`; `sleep` advances it)

- [ ] **Step 1: Add the shared test fakes**

Append to `extensions/null-accounts/src/testFakes.ts`, and add `import type { PostForm } from './providers/gitlabOAuth';` below the existing import:

```ts
export interface Reply { status?: number; body: unknown }

/** A `PostForm` that answers from a queue (status defaults to 200) and records what it was asked. */
export function fakePost(...replies: Reply[]): {
  post: PostForm;
  calls: Array<{ url: string; form: Record<string, string> }>;
} {
  const calls: Array<{ url: string; form: Record<string, string> }> = [];
  const post: PostForm = async (url, form) => {
    calls.push({ url, form });
    const next = replies.shift();
    if (!next) { throw new Error('unexpected extra request'); }
    return { status: next.status ?? 200, body: next.body };
  };
  return { post, calls };
}

/** A clock whose `sleep` just advances time, so polling tests run instantly. */
export function fakeClock(): { now(): number; sleep(ms: number): Promise<void>; slept: number[] } {
  let t = 1_000_000;
  const slept: number[] = [];
  return { slept, now: () => t, sleep: async ms => { slept.push(ms); t += ms; } };
}
```

- [ ] **Step 2: Write the failing tests**

Create `extensions/null-accounts/src/providers/gitlabOAuth.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { fakeClock, fakePost } from '../testFakes';
import {
  DeviceCode, OAuthError, parseTokens, pollForToken, refreshTokens, serializeTokens, startDeviceFlow,
} from './gitlabOAuth';

const code: DeviceCode = {
  deviceCode: 'dc', userCode: 'UC', verificationUri: 'https://gitlab.com/oauth/device', expiresIn: 300, interval: 5,
};
const pending = { status: 400, body: { error: 'authorization_pending' } };
const granted = { body: { access_token: 'at', refresh_token: 'rt', expires_in: 7200 } };

const failsWith = (reason: string) => (e: unknown): boolean => e instanceof OAuthError && e.reason === reason;

test('startDeviceFlow posts the client id and scopes and maps the response', async () => {
  const { post, calls } = fakePost({
    body: {
      device_code: 'dc', user_code: 'UC', verification_uri: 'https://git.example.org:8443/oauth/device',
      verification_uri_complete: 'https://git.example.org:8443/oauth/device?user_code=UC', expires_in: 300, interval: 5,
    },
  });
  const got = await startDeviceFlow(post, 'git.example.org:8443', 'cid');
  assert.strictEqual(calls[0].url, 'https://git.example.org:8443/oauth/authorize_device');
  assert.deepStrictEqual(calls[0].form, { client_id: 'cid', scope: 'read_user api write_repository' });
  assert.deepStrictEqual(got, {
    deviceCode: 'dc', userCode: 'UC', verificationUri: 'https://git.example.org:8443/oauth/device',
    verificationUriComplete: 'https://git.example.org:8443/oauth/device?user_code=UC', expiresIn: 300, interval: 5,
  });
});

test('startDeviceFlow refuses an error reply, missing fields, and a non-https verification URL', async () => {
  const ok = { device_code: 'dc', user_code: 'UC', verification_uri: 'https://gitlab.com/oauth/device' };
  for (const reply of [
    { status: 401, body: { error: 'invalid_client', error_description: 'Client authentication failed' } },
    { body: {} },
    { body: 'not json' },
    { body: { ...ok, verification_uri: 'http://gitlab.com/oauth/device' } },
    { body: { ...ok, verification_uri: 'javascript:alert(1)' } },
  ]) {
    await assert.rejects(startDeviceFlow(fakePost(reply).post, 'gitlab.com', 'cid'), failsWith('failed'), JSON.stringify(reply));
  }
});

test('startDeviceFlow drops a non-https verification_uri_complete but keeps the plain one', async () => {
  const { post } = fakePost({
    body: {
      device_code: 'dc', user_code: 'UC', verification_uri: 'https://gitlab.com/oauth/device',
      verification_uri_complete: 'http://evil.example/x',
    },
  });
  const got = await startDeviceFlow(post, 'gitlab.com', 'cid');
  assert.strictEqual(got.verificationUriComplete, undefined);
  assert.strictEqual(got.expiresIn, 300); // defaults when the server omits them
  assert.strictEqual(got.interval, 5);
});

test('pollForToken waits one interval before each poll and returns the tokens when granted', async () => {
  const { post, calls } = fakePost(pending, pending, granted);
  const clock = fakeClock();
  const start = clock.now();
  const tokens = await pollForToken(post, 'gitlab.com', 'cid', code, { ...clock, cancelled: () => false });
  assert.deepStrictEqual(clock.slept, [5000, 5000, 5000]);
  assert.deepStrictEqual(tokens, { accessToken: 'at', refreshToken: 'rt', expiresAt: start + 15_000 + 7_200_000 });
  assert.strictEqual(calls[0].url, 'https://gitlab.com/oauth/token');
  assert.deepStrictEqual(calls[0].form, {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: 'dc', client_id: 'cid',
  });
});

test('slow_down lengthens the polling interval by 5 seconds', async () => {
  const { post } = fakePost({ status: 400, body: { error: 'slow_down' } }, granted);
  const clock = fakeClock();
  await pollForToken(post, 'gitlab.com', 'cid', code, { ...clock, cancelled: () => false });
  assert.deepStrictEqual(clock.slept, [5000, 10_000]);
});

test('denied, server-expired and unknown errors end the flow with the right reason', async () => {
  const run = (body: unknown) =>
    pollForToken(fakePost({ status: 400, body }).post, 'gitlab.com', 'cid', code, { ...fakeClock(), cancelled: () => false });
  await assert.rejects(run({ error: 'access_denied' }), failsWith('denied'));
  await assert.rejects(run({ error: 'expired_token' }), failsWith('expired'));
  await assert.rejects(run({ error: 'server_error', error_description: 'boom' }), failsWith('failed'));
  await assert.rejects(run(undefined), failsWith('failed'));
});

test('the flow also gives up on its own once the code lifetime has passed', async () => {
  const { post, calls } = fakePost(pending, pending, pending);
  await assert.rejects(
    pollForToken(post, 'gitlab.com', 'cid', { ...code, expiresIn: 10, interval: 5 }, { ...fakeClock(), cancelled: () => false }),
    failsWith('expired'),
  );
  assert.strictEqual(calls.length, 1); // 5 s: poll; 10 s: out of time
});

test('a cancelled flow stops before asking the server again', async () => {
  const { post, calls } = fakePost();
  await assert.rejects(
    pollForToken(post, 'gitlab.com', 'cid', code, { ...fakeClock(), cancelled: () => true }),
    failsWith('cancelled'),
  );
  assert.strictEqual(calls.length, 0);
});

test('refreshTokens posts the refresh grant and maps the rotated pair', async () => {
  const { post, calls } = fakePost({ body: { access_token: 'new', refresh_token: 'rt2', expires_in: 7200 } });
  const clock = fakeClock();
  const got = await refreshTokens(post, 'gitlab.com', 'cid', 'rt1', clock.now);
  assert.deepStrictEqual(got, { accessToken: 'new', refreshToken: 'rt2', expiresAt: clock.now() + 7_200_000 });
  assert.deepStrictEqual(calls[0].form, { grant_type: 'refresh_token', refresh_token: 'rt1', client_id: 'cid' });
});

test('refreshTokens: 400/401 means rejected; any other failure means transient', async () => {
  const run = (reply: { status: number; body: unknown }) =>
    refreshTokens(fakePost(reply).post, 'gitlab.com', 'cid', 'rt1', fakeClock().now);
  await assert.rejects(run({ status: 400, body: { error: 'invalid_grant' } }), failsWith('rejected'));
  await assert.rejects(run({ status: 401, body: {} }), failsWith('rejected'));
  await assert.rejects(run({ status: 500, body: 'oops' }), failsWith('failed'));
  await assert.rejects(run({ status: 200, body: {} }), failsWith('failed')); // 200 without a token is not a refresh
  // a network failure is not an OAuthError at all: the caller treats it as transient too
  await assert.rejects(
    refreshTokens(async () => { throw new Error('offline'); }, 'gitlab.com', 'cid', 'rt1', fakeClock().now),
    (e: unknown) => !(e instanceof OAuthError),
  );
});

test('tokens survive a serialise/parse round trip; junk parses to undefined', () => {
  const t = { accessToken: 'at', refreshToken: 'rt', expiresAt: 123 };
  assert.deepStrictEqual(parseTokens(serializeTokens(t)), t);
  assert.deepStrictEqual(parseTokens(serializeTokens({ accessToken: 'at' })), { accessToken: 'at', refreshToken: undefined, expiresAt: undefined });
  for (const bad of [undefined, '', 'not json', '[]', '{}', '{"accessToken":""}', '{"accessToken":5}', 'null']) {
    assert.strictEqual(parseTokens(bad), undefined, String(bad));
  }
});
```

- [ ] **Step 3: Add the test file to the runner and watch it fail**

In `extensions/null-accounts/package.json`, append ` out/providers/gitlabOAuth.test.js` to the end of the `scripts.test` string (after `out/ui/accountsMenuActions.test.js`).

Run: `npm --prefix extensions/null-accounts test`
Expected: FAIL at the `tsc` step — `Cannot find module './gitlabOAuth'`.

- [ ] **Step 4: Write the implementation**

Create `extensions/null-accounts/src/providers/gitlabOAuth.ts`:

```ts
'use strict';

/** From the design spec: identity, API access for later Issues/MR features, and git over https. */
export const GITLAB_SCOPES = 'read_user api write_repository';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
/** A token this close to expiry counts as expired, so it can't lapse mid-request. */
export const EXPIRY_MARGIN_MS = 60_000;

export interface FormResponse { status: number; body: unknown }
/** POST application/x-www-form-urlencoded. Resolves any HTTP response; rejects only on a network failure. */
export type PostForm = (url: string, form: Record<string, string>) => Promise<FormResponse>;

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  /** Seconds the device code stays valid. */
  expiresIn: number;
  /** Seconds between polls. */
  interval: number;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms; absent means the token does not expire. */
  expiresAt?: number;
}

export type OAuthFailure = 'denied' | 'expired' | 'cancelled' | 'rejected' | 'failed';

export class OAuthError extends Error {
  constructor(readonly reason: OAuthFailure, message: string) { super(message); }
}

export const asRecord = (v: unknown): Record<string, unknown> =>
  (typeof v === 'object' && v !== null ? v as Record<string, unknown> : {});
/** A non-empty string, else undefined. */
export const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

const httpsOnly = (v: unknown): string | undefined => {
  const s = str(v);
  return s?.startsWith('https://') ? s : undefined;
};

function describe(res: FormResponse): string {
  const b = asRecord(res.body);
  return str(b.error_description) ?? str(b.error) ?? `HTTP ${res.status}`;
}

function tokenSetFrom(body: unknown, now: number): TokenSet | undefined {
  const b = asRecord(body);
  const accessToken = str(b.access_token);
  if (!accessToken) { return undefined; }
  return {
    accessToken,
    refreshToken: str(b.refresh_token),
    expiresAt: typeof b.expires_in === 'number' ? now + b.expires_in * 1000 : undefined,
  };
}

export async function startDeviceFlow(post: PostForm, host: string, clientId: string): Promise<DeviceCode> {
  const res = await post(`https://${host}/oauth/authorize_device`, { client_id: clientId, scope: GITLAB_SCOPES });
  const b = asRecord(res.body);
  const deviceCode = str(b.device_code);
  const userCode = str(b.user_code);
  // The URL is opened in the user's browser, so a server-supplied one must be https.
  const verificationUri = httpsOnly(b.verification_uri);
  if (res.status !== 200 || !deviceCode || !userCode || !verificationUri) {
    throw new OAuthError('failed', `GitLab did not start the sign-in: ${describe(res)}`);
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete: httpsOnly(b.verification_uri_complete),
    expiresIn: typeof b.expires_in === 'number' ? b.expires_in : 300,
    interval: typeof b.interval === 'number' ? b.interval : 5,
  };
}

export interface PollOptions {
  sleep(ms: number): Promise<void>;
  now(): number;
  cancelled(): boolean;
}

/** Polls until the user approves. A network failure while polling ends the flow (ponytail: no retry; the user starts over). */
export async function pollForToken(
  post: PostForm,
  host: string,
  clientId: string,
  code: DeviceCode,
  { sleep, now, cancelled }: PollOptions,
): Promise<TokenSet> {
  let interval = code.interval;
  const deadline = now() + code.expiresIn * 1000;
  for (;;) {
    await sleep(interval * 1000);
    if (cancelled()) { throw new OAuthError('cancelled', 'Sign-in cancelled.'); }
    if (now() >= deadline) { throw new OAuthError('expired', 'The sign-in code expired. Try again.'); }
    const res = await post(`https://${host}/oauth/token`, {
      grant_type: DEVICE_GRANT, device_code: code.deviceCode, client_id: clientId,
    });
    const tokens = res.status === 200 ? tokenSetFrom(res.body, now()) : undefined;
    if (tokens) { return tokens; }
    switch (str(asRecord(res.body).error)) {
      case 'authorization_pending': break;
      case 'slow_down': interval += 5; break;
      case 'access_denied': throw new OAuthError('denied', 'Sign-in was denied.');
      case 'expired_token': throw new OAuthError('expired', 'The sign-in code expired. Try again.');
      default: throw new OAuthError('failed', `GitLab sign-in failed: ${describe(res)}`);
    }
  }
}

/** 400/401 = the server refused this refresh token ('rejected'); anything else may pass on its own ('failed'). */
export async function refreshTokens(
  post: PostForm,
  host: string,
  clientId: string,
  refreshToken: string,
  now: () => number,
): Promise<TokenSet> {
  const res = await post(`https://${host}/oauth/token`, {
    grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId,
  });
  const tokens = res.status === 200 ? tokenSetFrom(res.body, now()) : undefined;
  if (tokens) { return tokens; }
  throw new OAuthError(
    res.status === 400 || res.status === 401 ? 'rejected' : 'failed',
    `GitLab did not refresh the sign-in: ${describe(res)}`,
  );
}

export const serializeTokens = (t: TokenSet): string => JSON.stringify(t);

export function parseTokens(raw: string | undefined): TokenSet | undefined {
  if (!raw) { return undefined; }
  try {
    const b = asRecord(JSON.parse(raw));
    const accessToken = str(b.accessToken);
    if (!accessToken) { return undefined; }
    return {
      accessToken,
      refreshToken: str(b.refreshToken),
      expiresAt: typeof b.expiresAt === 'number' ? b.expiresAt : undefined,
    };
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix extensions/null-accounts test`
Expected: PASS — all suites green, including the 10 new `gitlabOAuth` tests.

- [ ] **Step 6: Commit**

```bash
git add extensions/null-accounts/src/providers/gitlabOAuth.ts extensions/null-accounts/src/providers/gitlabOAuth.test.ts extensions/null-accounts/src/testFakes.ts extensions/null-accounts/package.json
git commit -m "feat: add the null-accounts GitLab OAuth device-flow protocol" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `GitlabProvider` (sign-in, `getToken`, refresh, needs-re-auth)

**Files:**
- Create: `extensions/null-accounts/src/providers/gitlab.ts`
- Test: `extensions/null-accounts/src/providers/gitlab.test.ts`
- Modify: `extensions/null-accounts/package.json` (`scripts.test`)

**Interfaces:**
- Consumes: everything Task 1 lists; `TokenProvider`, `TokenOptions` from `../api`; `ChangeEmitter` from `../changeEmitter`; `Account`, `NewAccount` from `../types`.
- Produces (Tasks 4–5 import these exact names):
  - `GITLAB_COM = 'gitlab.com'`
  - `resolveClientId(host: string, clientId: unknown, hostClientIds: unknown): string | undefined`
  - `interface GitlabDeps` — `post: PostForm`; `get(host, apiPath, token?): Promise<FormResponse>`; `secrets: { get(id): PromiseLike<string | undefined>; set(id, value): Promise<void> }`; `clientIdFor(host): string | undefined`; `now(): number`; `sleep(ms): Promise<void>`; `onNeedsReauth(account: Account): void`; `promptReauth(account: Account): Promise<void>`
  - `interface DeviceFlowUi { show(code: DeviceCode): void; cancelled(): boolean }`
  - `class GitlabProvider implements TokenProvider` — `readonly onDidChange: vscode.Event<void>`; `needsReauth(id: string): boolean`; `signIn(host: string, ui: DeviceFlowUi): Promise<{ account: NewAccount; secret: string }>`; `reauthenticate(account: Account, ui: DeviceFlowUi): Promise<void>`; `getToken(account, scopes?, options?)`
  - `fetchPostForm: PostForm`, `fetchGitlab(host: string, apiPath: string, token?: string): Promise<FormResponse>` — the real HTTP helpers (no unit tests; thin wrappers over `fetch`, covered by Task 7's live check)

- [ ] **Step 1: Write the failing tests**

Create `extensions/null-accounts/src/providers/gitlab.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { Account } from '../types';
import { fakeClock, fakePost, Reply } from '../testFakes';
import { DeviceFlowUi, GitlabDeps, GitlabProvider, resolveClientId } from './gitlab';
import { FormResponse, parseTokens, serializeTokens, TokenSet } from './gitlabOAuth';

const NOW = 1_000_000; // where fakeClock starts

const tanuki: Account = {
  id: 'g1', provider: 'gitlab', host: 'gitlab.com', username: 'tanuki', email: 't@e.com', authMethod: 'oauth', externalId: '7',
};

const device: Reply = {
  body: { device_code: 'dc', user_code: 'UC', verification_uri: 'https://gitlab.com/oauth/device', expires_in: 300, interval: 5 },
};
const granted: Reply = { body: { access_token: 'at', refresh_token: 'rt', expires_in: 7200 } };
const refreshed: Reply = { body: { access_token: 'new', refresh_token: 'rt2', expires_in: 7200 } };
const versionOk: FormResponse = { status: 401, body: { message: '401 Unauthorized' } }; // /version needs a token: 401 is the normal answer
const profile: FormResponse = { status: 200, body: { id: 7, username: 'tanuki', email: 'tanuki@example.com' } };
const expired: TokenSet = { accessToken: 'old', refreshToken: 'rt1', expiresAt: NOW - 1 };

interface Setup {
  tokens?: TokenSet;
  replies?: Reply[];
  gets?: Record<string, FormResponse>;
  getFails?: boolean;
  clientId?: string | undefined;
  onPrompt?: (secrets: Map<string, string>) => void;
}

function make(opts: Setup = {}) {
  const { post, calls } = fakePost(...(opts.replies ?? []));
  const clock = fakeClock();
  const secrets = new Map<string, string>();
  if (opts.tokens) { secrets.set(tanuki.id, serializeTokens(opts.tokens)); }
  const notified: string[] = [];
  const prompted: string[] = [];
  const getCalls: Array<{ host: string; apiPath: string; token?: string }> = [];
  const deps: GitlabDeps = {
    post,
    get: async (host, apiPath, token) => {
      getCalls.push({ host, apiPath, token });
      if (opts.getFails) { throw new Error('offline'); }
      return opts.gets?.[apiPath] ?? { status: 404, body: {} };
    },
    secrets: { get: async id => secrets.get(id), set: async (id, value) => { secrets.set(id, value); } },
    clientIdFor: () => ('clientId' in opts ? opts.clientId : 'cid'),
    now: clock.now,
    sleep: clock.sleep,
    onNeedsReauth: a => { notified.push(a.id); },
    promptReauth: async a => { prompted.push(a.id); opts.onPrompt?.(secrets); },
  };
  return { provider: new GitlabProvider(deps), calls, getCalls, secrets, notified, prompted };
}

const ui = (): DeviceFlowUi & { shown: string[] } => {
  const shown: string[] = [];
  return { shown, show: c => { shown.push(c.userCode); }, cancelled: () => false };
};

const signInGets = { '/version': versionOk, '/user': profile };

test('signIn runs the device flow and describes the account from /user', async () => {
  const { provider, calls, getCalls } = make({ replies: [device, granted], gets: signInGets });
  const u = ui();
  const { account, secret } = await provider.signIn('gitlab.com', u);
  assert.deepStrictEqual(account, {
    provider: 'gitlab', host: 'gitlab.com', username: 'tanuki', email: 'tanuki@example.com', authMethod: 'oauth', externalId: '7',
  });
  assert.deepStrictEqual(u.shown, ['UC']);
  assert.strictEqual(calls[0].form.client_id, 'cid');
  assert.deepStrictEqual(parseTokens(secret), { accessToken: 'at', refreshToken: 'rt', expiresAt: NOW + 5000 + 7_200_000 });
  assert.strictEqual(getCalls[getCalls.length - 1].token, 'at'); // /user is read with the new token
});

test('signIn on a self-hosted host with a port uses it in every URL and falls back to a noreply email', async () => {
  const { provider, calls, getCalls } = make({
    replies: [device, granted],
    gets: { '/version': versionOk, '/user': { status: 200, body: { id: 7, username: 'tanuki' } } },
  });
  const { account } = await provider.signIn('git.example.org:8443', ui());
  assert.strictEqual(calls[0].url, 'https://git.example.org:8443/oauth/authorize_device');
  assert.strictEqual(getCalls[0].host, 'git.example.org:8443');
  assert.strictEqual(account.host, 'git.example.org:8443');
  assert.strictEqual(account.email, '7-tanuki@users.noreply.git.example.org'); // no port in the address
});

test('signIn without a client ID fails fast, naming the setting, before any network call', async () => {
  const { provider, calls, getCalls } = make({ clientId: undefined });
  await assert.rejects(provider.signIn('gitlab.com', ui()), /null-accounts\.gitlab/);
  assert.strictEqual(calls.length + getCalls.length, 0);
});

test('signIn rejects a host that is unreachable or not a GitLab server, before starting the flow', async () => {
  const notGitlab = make({ gets: { '/version': { status: 404, body: {} } } });
  await assert.rejects(notGitlab.provider.signIn('example.org', ui()), /does not look like a GitLab server/);
  const offline = make({ getFails: true });
  await assert.rejects(offline.provider.signIn('example.org', ui()), /Could not reach example\.org/);
  assert.strictEqual(notGitlab.calls.length + offline.calls.length, 0);
});

test('signIn fails clearly when the profile cannot be read', async () => {
  const { provider } = make({ replies: [device, granted], gets: { '/version': versionOk, '/user': { status: 403, body: {} } } });
  await assert.rejects(provider.signIn('gitlab.com', ui()), /profile/);
});

test('a fresh token is returned without any network call', async () => {
  const { provider, calls } = make({ tokens: { accessToken: 'live', refreshToken: 'rt1', expiresAt: NOW + 3_600_000 } });
  assert.strictEqual(await provider.getToken(tanuki), 'live');
  assert.strictEqual(calls.length, 0);
});

test('a token inside the 60 s margin is refreshed, and the rotated pair is persisted', async () => {
  const { provider, calls, secrets } = make({
    tokens: { accessToken: 'old', refreshToken: 'rt1', expiresAt: NOW + 30_000 },
    replies: [refreshed],
  });
  assert.strictEqual(await provider.getToken(tanuki), 'new');
  assert.deepStrictEqual(calls[0].form, { grant_type: 'refresh_token', refresh_token: 'rt1', client_id: 'cid' });
  assert.deepStrictEqual(parseTokens(secrets.get('g1')), { accessToken: 'new', refreshToken: 'rt2', expiresAt: NOW + 7_200_000 });
});

test('if the refresh reply carries no new refresh token, the old one is kept', async () => {
  const { provider, secrets } = make({ tokens: expired, replies: [{ body: { access_token: 'new', expires_in: 7200 } }] });
  await provider.getToken(tanuki);
  assert.strictEqual(parseTokens(secrets.get('g1'))?.refreshToken, 'rt1');
});

test('two simultaneous requests with an expired token share a single refresh', async () => {
  const { provider, calls } = make({ tokens: expired, replies: [refreshed] }); // a 2nd request would throw
  const [a, b] = await Promise.all([provider.getToken(tanuki), provider.getToken(tanuki)]);
  assert.deepStrictEqual([a, b], ['new', 'new']);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(provider.needsReauth('g1'), false);
});

test('a refresh the server rejects flags the account once, notifies once, and stops retrying', async () => {
  const { provider, calls, notified } = make({
    tokens: expired,
    replies: [{ status: 400, body: { error: 'invalid_grant' } }],
  });
  assert.strictEqual(await provider.getToken(tanuki), undefined);
  assert.strictEqual(await provider.getToken(tanuki), undefined); // no second request: it would throw
  assert.strictEqual(provider.needsReauth('g1'), true);
  assert.deepStrictEqual(notified, ['g1']);
  assert.strictEqual(calls.length, 1);
});

test('an offline or failing server does not flag re-auth and leaves the stored tokens alone', async () => {
  const { provider, secrets } = make({ tokens: expired, replies: [{ status: 503, body: 'down' }] });
  const before = secrets.get('g1');
  assert.strictEqual(await provider.getToken(tanuki), undefined);
  assert.strictEqual(provider.needsReauth('g1'), false);
  assert.strictEqual(secrets.get('g1'), before);
});

test('an expired token with no refresh token, or no stored tokens at all, needs re-auth', async () => {
  const noRefresh = make({ tokens: { accessToken: 'old', expiresAt: NOW - 1 } });
  assert.strictEqual(await noRefresh.provider.getToken(tanuki), undefined);
  assert.strictEqual(noRefresh.provider.needsReauth('g1'), true);
  const nothing = make();
  assert.strictEqual(await nothing.provider.getToken(tanuki), undefined);
  assert.strictEqual(nothing.provider.needsReauth('g1'), true);
});

test('a missing client ID is not blamed on the sign-in: undefined, no flag', async () => {
  const { provider } = make({ tokens: expired, clientId: undefined });
  assert.strictEqual(await provider.getToken(tanuki), undefined);
  assert.strictEqual(provider.needsReauth('g1'), false);
});

test('accounts of another provider get nothing', async () => {
  const { provider } = make();
  assert.strictEqual(await provider.getToken({ ...tanuki, provider: 'github' }), undefined);
});

test('only an interactive request prompts for re-auth, and it then returns the repaired token', async () => {
  const repair = (secrets: Map<string, string>) => {
    secrets.set('g1', serializeTokens({ accessToken: 'fresh', expiresAt: NOW + 7_200_000 }));
  };
  const rejected = { status: 400, body: { error: 'invalid_grant' } };

  const silent = make({ tokens: expired, replies: [rejected], onPrompt: repair });
  assert.strictEqual(await silent.provider.getToken(tanuki), undefined);
  assert.deepStrictEqual(silent.prompted, []);

  const loud = make({ tokens: expired, replies: [rejected], onPrompt: repair });
  assert.strictEqual(await loud.provider.getToken(tanuki, undefined, { interactive: true }), 'fresh');
  assert.deepStrictEqual(loud.prompted, ['g1']);
  assert.strictEqual(loud.provider.needsReauth('g1'), false); // a good token clears the flag
});

test('reauthenticate stores the new tokens and clears the flag', async () => {
  const { provider, secrets } = make({ replies: [device, granted], gets: signInGets });
  await provider.getToken(tanuki); // no tokens yet: flagged
  assert.strictEqual(provider.needsReauth('g1'), true);
  await provider.reauthenticate(tanuki, ui());
  assert.strictEqual(provider.needsReauth('g1'), false);
  assert.strictEqual(parseTokens(secrets.get('g1'))?.accessToken, 'at');
});

test('reauthenticate refuses a different GitLab user and keeps the stored tokens', async () => {
  const { provider, secrets } = make({
    tokens: expired,
    replies: [device, granted],
    gets: { '/version': versionOk, '/user': { status: 200, body: { id: 9, username: 'someone-else', email: 's@e.com' } } },
  });
  const before = secrets.get('g1');
  await assert.rejects(provider.reauthenticate(tanuki, ui()), /signed in as someone-else.*tanuki/);
  assert.strictEqual(secrets.get('g1'), before);
});

test('needsReauth changes fire onDidChange so the panel refreshes', async () => {
  const { provider } = make();
  let fired = 0;
  provider.onDidChange(() => { fired++; });
  await provider.getToken(tanuki); // flags
  await provider.getToken(tanuki); // already flagged: no second event
  assert.strictEqual(fired, 1);
});

test('resolveClientId reads the gitlab.com setting for gitlab.com and the per-host map elsewhere', () => {
  assert.strictEqual(resolveClientId('gitlab.com', ' abc ', {}), 'abc');
  assert.strictEqual(resolveClientId('gitlab.com', '', {}), undefined);
  assert.strictEqual(resolveClientId('git.example.org', 'abc', { 'git.example.org': 'zzz' }), 'zzz');
  assert.strictEqual(resolveClientId('git.example.org', 'abc', {}), undefined); // gitlab.com's ID is not reused
  assert.strictEqual(resolveClientId('git.example.org', 'abc', 'junk'), undefined);
  assert.strictEqual(resolveClientId('git.example.org', 'abc', { 'git.example.org': 5 }), undefined);
});
```

- [ ] **Step 2: Add the test file to the runner and watch it fail**

Append ` out/providers/gitlab.test.js` to the end of the `scripts.test` string in `extensions/null-accounts/package.json`.

Run: `npm --prefix extensions/null-accounts test`
Expected: FAIL at the `tsc` step — `Cannot find module './gitlab'`.

- [ ] **Step 3: Write the implementation**

Create `extensions/null-accounts/src/providers/gitlab.ts`:

```ts
'use strict';

import { TokenOptions, TokenProvider } from '../api';
import { ChangeEmitter } from '../changeEmitter';
import { Account, NewAccount } from '../types';
import {
  asRecord, DeviceCode, EXPIRY_MARGIN_MS, FormResponse, OAuthError, parseTokens, pollForToken, PostForm,
  refreshTokens, serializeTokens, startDeviceFlow, str, TokenSet,
} from './gitlabOAuth';

export const GITLAB_COM = 'gitlab.com';

/** gitlab.com uses `null-accounts.gitlab.clientId`; a self-hosted host needs its own entry in `hostClientIds`. */
export function resolveClientId(host: string, clientId: unknown, hostClientIds: unknown): string | undefined {
  const value = host === GITLAB_COM ? clientId : asRecord(hostClientIds)[host];
  return typeof value === 'string' ? str(value.trim()) : undefined;
}

export interface GitlabDeps {
  post: PostForm;
  /** GET https://<host>/api/v4<apiPath>, with a bearer token when given. Resolves any HTTP response; rejects only on a network failure. */
  get(host: string, apiPath: string, token?: string): Promise<FormResponse>;
  secrets: {
    get(id: string): PromiseLike<string | undefined>;
    set(id: string, value: string): Promise<void>;
  };
  clientIdFor(host: string): string | undefined;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Called once per account when its sign-in can no longer be refreshed. */
  onNeedsReauth(account: Account): void;
  /** Interactive `getToken` only: run the sign-in again (ui/accountPicker `reauthenticate`). */
  promptReauth(account: Account): Promise<void>;
}

export interface DeviceFlowUi {
  /** Show the user code and open the verification page. */
  show(code: DeviceCode): void;
  cancelled(): boolean;
}

export class GitlabProvider implements TokenProvider {
  private readonly emitter = new ChangeEmitter();
  /** Fires when an account's "needs re-auth" state changes. */
  readonly onDidChange = this.emitter.event;
  // In memory only: after a restart the next getToken retries the refresh and flags it again if it still fails.
  private readonly stale = new Set<string>();
  private readonly refreshing = new Map<string, Promise<string | undefined>>();

  constructor(private readonly deps: GitlabDeps) {}

  needsReauth(id: string): boolean {
    return this.stale.has(id);
  }

  /** Runs the device flow and describes who signed in. The caller stores `secret` with the account. */
  async signIn(host: string, ui: DeviceFlowUi): Promise<{ account: NewAccount; secret: string }> {
    const clientId = this.deps.clientIdFor(host);
    if (!clientId) {
      throw new Error(
        `No GitLab OAuth client ID is set for ${host}. Set null-accounts.gitlab.clientId (gitlab.com) or add "${host}" to null-accounts.gitlab.hostClientIds.`,
      );
    }
    await this.checkHost(host);
    const code = await startDeviceFlow(this.deps.post, host, clientId);
    ui.show(code);
    const tokens = await pollForToken(this.deps.post, host, clientId, code, {
      sleep: this.deps.sleep, now: this.deps.now, cancelled: () => ui.cancelled(),
    });
    const res = await this.deps.get(host, '/user', tokens.accessToken);
    const user = asRecord(res.body);
    const username = str(user.username);
    if (res.status !== 200 || !username) {
      throw new Error(`Could not read the GitLab profile (HTTP ${res.status}).`);
    }
    const id = typeof user.id === 'number' ? String(user.id) : undefined;
    const bareHost = host.replace(/:\d+$/, '');
    return {
      account: {
        provider: 'gitlab',
        host,
        username,
        email: str(user.email) ?? `${id ? `${id}-` : ''}${username}@users.noreply.${bareHost}`,
        authMethod: 'oauth',
        externalId: id,
      },
      secret: serializeTokens(tokens),
    };
  }

  /** Signs in again and replaces the stored tokens; refuses a different GitLab user than the account's. */
  async reauthenticate(account: Account, ui: DeviceFlowUi): Promise<void> {
    const { account: who, secret } = await this.signIn(account.host, ui);
    if (who.username.toLowerCase() !== account.username.toLowerCase()) {
      throw new Error(`You signed in as ${who.username}, but this account is ${account.username}.`);
    }
    await this.deps.secrets.set(account.id, secret);
    this.unflag(account.id);
  }

  /** `_scopes` is ignored: GitLab scopes are fixed when the user signs in. */
  async getToken(account: Account, _scopes?: string[], options?: TokenOptions): Promise<string | undefined> {
    if (account.provider !== 'gitlab') { return undefined; }
    const token = await this.usableToken(account);
    if (token || !options?.interactive) { return token; }
    await this.deps.promptReauth(account);
    return this.usableToken(account);
  }

  /** 200 or 401 from /api/v4/version means a GitLab API answered (it needs a token, so 401 is the normal reply). */
  // ponytail: any https server answering 401 passes; the OAuth call that follows is the real check.
  private async checkHost(host: string): Promise<void> {
    const res = await this.deps.get(host, '/version').catch(() => undefined);
    if (!res) { throw new Error(`Could not reach ${host}.`); }
    if (res.status !== 200 && res.status !== 401) {
      throw new Error(`${host} does not look like a GitLab server (HTTP ${res.status}).`);
    }
  }

  private async usableToken(account: Account): Promise<string | undefined> {
    const tokens = parseTokens(await this.deps.secrets.get(account.id));
    if (!tokens) {
      this.flag(account);
      return undefined;
    }
    if (tokens.expiresAt === undefined || tokens.expiresAt - EXPIRY_MARGIN_MS > this.deps.now()) {
      this.unflag(account.id);
      return tokens.accessToken;
    }
    if (this.stale.has(account.id)) { return undefined; } // already known dead; don't hit the server on every call
    let pending = this.refreshing.get(account.id);
    if (!pending) {
      // GitLab rotates the refresh token: a second parallel refresh would send the spent one and be rejected.
      pending = this.refresh(account, tokens).finally(() => this.refreshing.delete(account.id));
      this.refreshing.set(account.id, pending);
    }
    return pending;
  }

  private async refresh(account: Account, old: TokenSet): Promise<string | undefined> {
    if (!old.refreshToken) {
      this.flag(account);
      return undefined;
    }
    const clientId = this.deps.clientIdFor(account.host);
    if (!clientId) { return undefined; } // a settings problem, not a dead sign-in
    try {
      const fresh = await refreshTokens(this.deps.post, account.host, clientId, old.refreshToken, this.deps.now);
      const next: TokenSet = { ...fresh, refreshToken: fresh.refreshToken ?? old.refreshToken };
      await this.deps.secrets.set(account.id, serializeTokens(next));
      return next.accessToken;
    } catch (err) {
      if (err instanceof OAuthError && err.reason === 'rejected') { this.flag(account); }
      return undefined; // offline / 5xx: leave the tokens, try again on the next call
    }
  }

  private flag(account: Account): void {
    if (this.stale.has(account.id)) { return; }
    this.stale.add(account.id);
    this.emitter.fire();
    this.deps.onNeedsReauth(account);
  }

  private unflag(id: string): void {
    if (this.stale.delete(id)) { this.emitter.fire(); }
  }
}

const readBody = (res: Response): Promise<unknown> => res.json().catch(() => undefined);

/** The real `GitlabDeps.post`. `redirect: 'error'` keeps a token request from being bounced to another host. */
export const fetchPostForm: PostForm = async (url, form) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'null-ide' },
    body: new URLSearchParams(form),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, body: await readBody(res) };
};

/** The real `GitlabDeps.get`. */
export async function fetchGitlab(host: string, apiPath: string, token?: string): Promise<FormResponse> {
  const res = await fetch(`https://${host}/api/v4${apiPath}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'null-ide', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, body: await readBody(res) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix extensions/null-accounts test`
Expected: PASS — all suites green, including the 17 new `gitlab` tests.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-accounts/src/providers/gitlab.ts extensions/null-accounts/src/providers/gitlab.test.ts extensions/null-accounts/package.json
git commit -m "feat: add the null-accounts GitLab provider with token refresh" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Store tokens on re-sign-in (`addOrRefresh`)

Signing in again as a stored GitLab account must replace its tokens (that is how an expired sign-in is repaired from the Add flow too), not fail as a duplicate and not drop the new tokens.

**Files:**
- Modify: `extensions/null-accounts/src/accountSetup.ts`
- Test: `extensions/null-accounts/src/accountSetup.test.ts`

**Interfaces:**
- Consumes: `findAccount` (same file); `AccountStore.add(input, secret?)` / `setSecret(id, value)`.
- Produces: `addOrRefresh(accounts: Accounts & { setSecret(id: string, value: string): Promise<void> }, candidate: NewAccount, secret: string): Promise<Account>` — Task 5 imports it from `../accountSetup`.

- [ ] **Step 1: Write the failing tests**

Append to `extensions/null-accounts/src/accountSetup.test.ts`, and change its `./accountSetup` import to `import { addOrRefresh, addOrReuse, findAccount, importExisting } from './accountSetup';`. The existing `setup()` hides the vault, so add a vault-aware setup next to it:

```ts
function setupWithVault() {
  let n = 0;
  const vault = new FakeVault();
  const accounts = new AccountStore(new FakeMeta(), vault, () => `id-${++n}`);
  return { accounts, vault };
}

const tanuki: NewAccount = {
  provider: 'gitlab', host: 'gitlab.com', username: 'tanuki', email: 't@e.com', authMethod: 'oauth', externalId: '7',
};

test('addOrRefresh adds a new account together with its tokens', async () => {
  const { accounts, vault } = setupWithVault();
  const account = await addOrRefresh(accounts, tanuki, 'tokens-1');
  assert.strictEqual(accounts.list().length, 1);
  assert.strictEqual(vault.data.get(`null-accounts/${account.id}`), 'tokens-1');
});

test('addOrRefresh on a stored account replaces its tokens instead of failing as a duplicate', async () => {
  const { accounts, vault } = setupWithVault();
  const first = await addOrRefresh(accounts, tanuki, 'tokens-1');
  const again = await addOrRefresh(accounts, { ...tanuki, username: 'Tanuki' }, 'tokens-2');
  assert.strictEqual(again.id, first.id);
  assert.strictEqual(accounts.list().length, 1);
  assert.strictEqual(vault.data.get(`null-accounts/${first.id}`), 'tokens-2');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix extensions/null-accounts test`
Expected: FAIL at `tsc` — `'addOrRefresh' is not exported`.

- [ ] **Step 3: Implement**

In `extensions/null-accounts/src/accountSetup.ts`, add after `addOrReuse`:

```ts
/** GitLab sign-in: add the account with its tokens, or (already stored) replace the tokens — how an expired sign-in is repaired. */
export async function addOrRefresh(
  accounts: Accounts & { setSecret(id: string, value: string): Promise<void> },
  candidate: NewAccount,
  secret: string,
): Promise<Account> {
  const existing = findAccount(accounts.list(), candidate);
  if (!existing) { return accounts.add(candidate, secret); }
  await accounts.setSecret(existing.id, secret);
  return existing;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix extensions/null-accounts test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-accounts/src/accountSetup.ts extensions/null-accounts/src/accountSetup.test.ts
git commit -m "feat: let a GitLab re-sign-in replace a stored account's tokens" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Pure UI pieces (pick items, panel rows, panel messages, page)

**Files:**
- Modify: `extensions/null-accounts/src/ui/pickItems.ts`, `pickItems.test.ts`
- Modify: `extensions/null-accounts/src/ui/accountsView.ts`, `accountsView.test.ts`
- Modify: `extensions/null-accounts/src/ui/panelMessages.ts`, `panelMessages.test.ts`
- Modify: `extensions/null-accounts/src/ui/accountsHtml.ts`, `accountsHtml.test.ts`, `accountsClient.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (Task 5 imports these exact names):
  - `pickItems.ts`: `ADD_ACCOUNT_LABEL` (replaces `ADD_GITHUB_LABEL`), `type ProviderChoice = 'github' | 'gitlab' | 'gitlab-self-hosted'`, `providerPickItems(): Array<{ label: string; description: string; choice: ProviderChoice }>`
  - `accountsView.ts`: `AccountRow.needsReauth: boolean`; `buildRows(accounts, entries, resolve, needsReauth?: (id: string) => boolean)` (default `() => false`)
  - `panelMessages.ts`: `PanelMessage` gains `{ type: 'reauth'; id: string }`

- [ ] **Step 1: Update and add the tests**

`ui/pickItems.test.ts` — rename the constant in the import (line 6) and the assertion (line 19):

```ts
import { ADD_ACCOUNT_LABEL, buildPickItems, PickItem, providerPickItems, UNBIND_LABEL } from './pickItems';
// ...
  assert.strictEqual(items[3].label, ADD_ACCOUNT_LABEL);
```

and append:

```ts
test('the provider choices are GitHub, gitlab.com and self-hosted GitLab, in that order', () => {
  assert.deepStrictEqual(providerPickItems().map(p => p.choice), ['github', 'gitlab', 'gitlab-self-hosted']);
  assert.strictEqual(ADD_ACCOUNT_LABEL, '$(add) Add account…');
});
```

`ui/accountsView.test.ts` — replace the key-list assertion in the "rows carry only display fields" test and add a flag test:

```ts
test('rows carry only display fields — no secrets or provider internals', () => {
  const rows = buildRows([{ ...acct('a1'), externalId: 'ext-1' }], [], exists);
  assert.deepStrictEqual(Object.keys(rows[0]).sort(),
    ['authMethod', 'email', 'host', 'id', 'needsReauth', 'projects', 'provider', 'username']);
});

test('needsReauth is taken from the callback per account and defaults to false', () => {
  assert.strictEqual(buildRows([acct('a1')], [], exists)[0].needsReauth, false);
  const rows = buildRows([acct('a1'), acct('a2')], [], exists, id => id === 'a2');
  assert.deepStrictEqual(rows.map(r => r.needsReauth), [false, true]);
});
```

`ui/panelMessages.test.ts` — add one parse case and two reject cases:

```ts
// in 'well-formed messages parse and drop unknown fields':
  assert.deepStrictEqual(parsePanelMessage({ type: 'reauth', id: 'a1', extra: 1 }), { type: 'reauth', id: 'a1' });
// in the rejected list:
    { type: 'reauth' }, { type: 'reauth', id: '' },
```

`ui/accountsHtml.test.ts` — append:

```ts
test('the client script can ask the host to re-authenticate an account', () => {
  assert.match(CLIENT_SCRIPT, /type: 'reauth'/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix extensions/null-accounts test`
Expected: FAIL at `tsc` — `'ADD_ACCOUNT_LABEL' is not exported`, `needsReauth` missing on `AccountRow`.

- [ ] **Step 3: Implement**

`ui/pickItems.ts` — replace the `ADD_GITHUB_LABEL` line, update its use inside `buildPickItems`, and add the provider choices:

```ts
export const ADD_ACCOUNT_LABEL = '$(add) Add account…';
// in buildPickItems:
  items.push({ label: ADD_ACCOUNT_LABEL, action: { kind: 'add' } });
```

```ts
export type ProviderChoice = 'github' | 'gitlab' | 'gitlab-self-hosted';

/** The second quick-pick, shown after "Add account…". */
export const providerPickItems = (): Array<{ label: string; description: string; choice: ProviderChoice }> => [
  { label: 'GitHub', description: 'github.com', choice: 'github' },
  { label: 'GitLab', description: 'gitlab.com', choice: 'gitlab' },
  { label: 'GitLab self-hosted…', description: 'your own server (https)', choice: 'gitlab-self-hosted' },
];
```

`ui/accountsView.ts` — add the field and the callback:

```ts
export interface AccountRow {
  // ...existing fields...
  authMethod: Account['authMethod'];
  /** The sign-in has expired and cannot be refreshed; the panel offers Re-authenticate. */
  needsReauth: boolean;
  projects: ProjectRef[];
}
```

```ts
export function buildRows(
  accounts: readonly Account[],
  entries: ReadonlyArray<readonly [string, string]>,
  resolve: ResolveFolder,
  needsReauth: (id: string) => boolean = () => false,
): AccountRow[] {
  return accounts.map(a => ({
    // ...existing fields through authMethod...
    authMethod: a.authMethod,
    needsReauth: needsReauth(a.id),
    projects: entries
```

`ui/panelMessages.ts` — add to the union and the switch:

```ts
  | { type: 'reauth'; id: string }
// ...
    case 'remove':
    case 'editEmail':
    case 'reauth':
      return nonEmpty(m.id) ? { type, id: m.id } : undefined;
```

`ui/accountsHtml.ts` — subtitle, button label and a warning style:

```ts
// CSS, after the `.meta,.email,.ppath` rule:
.warn{color:var(--vscode-editorWarning-foreground);margin:2px 0 0;}
// body:
  <p class="subtitle">Each project uses one account for GitHub and GitLab features.</p>
  <div id="toolbar"><button id="add-btn" class="primary">Add account</button></div>
```

`ui/accountsClient.ts` — in `render`, replace the `actions` block and the final `card.append`:

```js
    const actions = el('div', 'actions');
    if (row.needsReauth) {
      actions.append(button('Re-authenticate', () => vscode.postMessage({ type: 'reauth', id: row.id }), 'primary'));
    }
    actions.append(
      button('Edit email', () => vscode.postMessage({ type: 'editEmail', id: row.id })),
      button('Remove', () => vscode.postMessage({ type: 'remove', id: row.id }), 'danger'),
    );
```

```js
    const lines = [head, el('div', 'email', row.email)];
    if (row.needsReauth) { lines.push(el('div', 'warn', 'Sign-in expired. Re-authenticate to use this account again.')); }
    card.append(...lines, actions, projects);
```

(Both snippets sit inside the `CLIENT_SCRIPT` template literal — they contain no backticks or `${`.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix extensions/null-accounts test`
Expected: PASS. (Nothing outside the files above used `ADD_GITHUB_LABEL`; `accountsPanel.ts` still compiles because `buildRows`' new parameter is optional and its `switch` has no exhaustiveness check.)

- [ ] **Step 5: Commit**

```bash
git add extensions/null-accounts/src/ui
git commit -m "feat: add GitLab provider choices and a re-auth state to the null-accounts UI model" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wire it up (picker, panel, extension, settings)

`vscode`-bound glue; the logic it calls is tested in Tasks 1–4. Verified by `tsc`, the settings guard test below, and Task 7's live run.

**Files:**
- Modify: `extensions/null-accounts/src/ui/accountPicker.ts` (full replacement below)
- Modify: `extensions/null-accounts/src/ui/accountsPanel.ts`
- Modify: `extensions/null-accounts/src/extension.ts`
- Modify: `extensions/null-accounts/src/api.ts` (one comment)
- Modify: `extensions/null-accounts/package.json` (`contributes.configuration`)
- Test: `extensions/null-accounts/src/providers/gitlab.test.ts` (settings guard)

**Interfaces:**
- Consumes: `GitlabProvider`, `DeviceFlowUi`, `GITLAB_COM`, `resolveClientId`, `fetchPostForm`, `fetchGitlab` (Task 2); `addOrRefresh` (Task 3); `providerPickItems`, `ADD_ACCOUNT_LABEL` (Task 4); `OAuthError` (Task 1); `normalizeHost` from `../accountInput`.
- Produces: `addAccount(deps: PickerDeps): Promise<Account | undefined>`, `reauthenticate(deps: PickerDeps, accountId: string): Promise<void>`; `PickerDeps` gains `gitlab: GitlabProvider`; `PanelDeps` loses `addGithub` and gains `add(): Promise<Account | undefined>`, `reauth(id: string): Promise<void>`, `needsReauth(id: string): boolean`.

- [ ] **Step 1: Write the failing settings guard**

Append to `extensions/null-accounts/src/providers/gitlab.test.ts` (add `import { readFileSync } from 'node:fs';` and `import path from 'node:path';` to its imports):

```ts
test('GitLab client IDs are application-scoped, so a workspace cannot swap in its own OAuth app', () => {
  const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  for (const key of ['null-accounts.gitlab.clientId', 'null-accounts.gitlab.hostClientIds']) {
    assert.strictEqual(pkg.contributes.configuration.properties[key]?.scope, 'application', key);
  }
});
```

Run: `npm --prefix extensions/null-accounts test`
Expected: FAIL — `null-accounts.gitlab.clientId: undefined !== 'application'`.

- [ ] **Step 2: Add the settings**

In `extensions/null-accounts/package.json`, inside `contributes` (next to `commands`), add:

```json
    "configuration": {
      "title": "Null Accounts",
      "properties": {
        "null-accounts.gitlab.clientId": {
          "type": "string",
          "default": "",
          "scope": "application",
          "markdownDescription": "OAuth application ID (device flow, public client) used to sign in to **gitlab.com**."
        },
        "null-accounts.gitlab.hostClientIds": {
          "type": "object",
          "default": {},
          "scope": "application",
          "additionalProperties": { "type": "string" },
          "markdownDescription": "OAuth application ID per self-hosted GitLab host, e.g. `{ \"git.example.org\": \"abc123\" }`. Register the application on that instance as a non-confidential app with the scopes `read_user api write_repository`."
        }
      }
    },
```

Run: `npm --prefix extensions/null-accounts test` — the guard passes (compile errors from the renames below are expected until Step 3–5 are done; run it again at the end).

- [ ] **Step 3: Replace `ui/accountPicker.ts`**

```ts
'use strict';

import path from 'node:path';
import * as vscode from 'vscode';
import { normalizeHost } from '../accountInput';
import { AccountStore } from '../accountStore';
import { addOrRefresh, addOrReuse } from '../accountSetup';
import { originUrl } from '../git';
import { ProjectBinding } from '../projectBinding';
import { GithubProvider } from '../providers/github';
import { DeviceFlowUi, GITLAB_COM, GitlabProvider } from '../providers/gitlab';
import { OAuthError } from '../providers/gitlabOAuth';
import { suggestAccount } from '../suggest';
import { Account } from '../types';
import { buildPickItems, PickItem, providerPickItems } from './pickItems';

export interface PickerDeps {
  accounts: AccountStore;
  bindings: ProjectBinding;
  github: GithubProvider;
  gitlab: GitlabProvider;
}

function reportFailure(what: string, err: unknown): void {
  if (err instanceof OAuthError && err.reason === 'cancelled') { return; }
  void vscode.window.showErrorMessage(`Could not ${what}: ${(err as Error).message}`);
}

/** Signs in to another GitHub account and stores it; resolves the stored one if it was already added. */
async function addGithubAccount(deps: PickerDeps): Promise<Account | undefined> {
  try {
    const fresh = await deps.github.signIn();
    return fresh ? await addOrReuse(deps.accounts, fresh) : undefined;
  } catch (err) {
    reportFailure('add the GitHub account', err);
    return undefined;
  }
}

/** A device-flow sign-in behind a cancellable notification: shows the code, copies it, opens the verification page. */
function withDeviceFlow<T>(title: string, run: (ui: DeviceFlowUi) => Promise<T>): Thenable<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: true },
    (progress, token) => run({
      show: code => {
        progress.report({ message: `Enter ${code.userCode} in your browser (copied to the clipboard)` });
        void vscode.env.clipboard.writeText(code.userCode);
        void vscode.env.openExternal(vscode.Uri.parse(code.verificationUriComplete ?? code.verificationUri));
      },
      cancelled: () => token.isCancellationRequested,
    }),
  );
}

async function addGitlabAccount(deps: PickerDeps, host: string): Promise<Account | undefined> {
  try {
    const { account, secret } = await withDeviceFlow(`Signing in to ${host}`, ui => deps.gitlab.signIn(host, ui));
    return await addOrRefresh(deps.accounts, account, secret);
  } catch (err) {
    reportFailure('add the GitLab account', err);
    return undefined;
  }
}

async function askSelfHostedHost(): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: 'Self-hosted GitLab',
    prompt: 'Host name of your GitLab server, e.g. git.example.org (https only)',
    validateInput: v => { try { normalizeHost(v); return undefined; } catch (err) { return (err as Error).message; } },
  });
  return value === undefined ? undefined : normalizeHost(value);
}

/** Asks which provider, then signs in and stores the account. `undefined` if the user backs out or sign-in fails. */
export async function addAccount(deps: PickerDeps): Promise<Account | undefined> {
  const picked = await vscode.window.showQuickPick(providerPickItems(), { placeHolder: 'Add an account from…' });
  if (!picked) { return undefined; }
  if (picked.choice === 'github') { return addGithubAccount(deps); }
  const host = picked.choice === 'gitlab' ? GITLAB_COM : await askSelfHostedHost();
  return host ? addGitlabAccount(deps, host) : undefined;
}

/** Signs a GitLab account in again (expired or revoked tokens). Failures are shown, never thrown. */
export async function reauthenticate(deps: PickerDeps, accountId: string): Promise<void> {
  const account = deps.accounts.get(accountId);
  if (!account || account.provider !== 'gitlab') { return; }
  try {
    await withDeviceFlow(`Signing in to ${account.host}`, ui => deps.gitlab.reauthenticate(account, ui));
  } catch (err) {
    reportFailure('re-authenticate', err);
  }
}

/** Quick-pick an account for the folder (suggesting one from its origin remote when unbound), then bind it. */
export async function chooseAccountForFolder(deps: PickerDeps, folder: vscode.Uri): Promise<Account | undefined> {
  const currentId = deps.bindings.accountIdFor(folder.fsPath);
  let suggestedId: string | undefined;
  if (currentId === undefined) {
    const origin = await originUrl(folder.fsPath);
    suggestedId = origin ? suggestAccount(origin, deps.accounts.list())?.id : undefined;
  }
  const picked = await vscode.window.showQuickPick<PickItem>(
    buildPickItems(deps.accounts.list(), { suggestedId, currentId }),
    { placeHolder: `Which account should "${path.basename(folder.fsPath)}" use?` },
  );
  if (!picked) { return undefined; }
  if (picked.action.kind === 'unbind') {
    await deps.bindings.unbind(folder.fsPath);
    return undefined;
  }
  const account = picked.action.kind === 'add' ? await addAccount(deps) : picked.action.account;
  if (!account) { return undefined; }
  await deps.bindings.bind(folder.fsPath, account.id);
  return account;
}
```

- [ ] **Step 4: Update `ui/accountsPanel.ts`**

Replace the `PanelDeps` interface:

```ts
export interface PanelDeps {
  accounts: AccountStore;
  bindings: ProjectBinding;
  /** Pick a provider, sign in and store the account (ui/accountPicker `addAccount`). */
  add(): Promise<Account | undefined>;
  /** Sign a GitLab account in again (ui/accountPicker `reauthenticate`). */
  reauth(id: string): Promise<void>;
  /** The account's sign-in has expired (GitlabProvider.needsReauth). */
  needsReauth(id: string): boolean;
  /** Fires when accounts, bindings or re-auth state change. */
  onDidChange: vscode.Event<void>;
}
```

In `postState`, pass the callback:

```ts
    const rows = buildRows(this.deps.accounts.list(), this.deps.bindings.entries(), resolveFolder, id => this.deps.needsReauth(id));
```

In `handle`'s switch, replace the `'add'` case and add `'reauth'`:

```ts
        case 'add': await this.deps.add(); break; // the store's change event refreshes the list
        case 'reauth': await this.deps.reauth(msg.id); break;
```

- [ ] **Step 5: Update `extension.ts` and `api.ts`**

`api.ts` line 42 comment → `/** Filled in per provider (github: Phase 2, gitlab: Phase 5). */`.

`extension.ts` — imports:

```ts
import { fetchGithub, GithubProvider } from './providers/github';
import { fetchGitlab, fetchPostForm, GitlabProvider, resolveClientId } from './providers/gitlab';
import { addAccount, chooseAccountForFolder, PickerDeps, reauthenticate } from './ui/accountPicker';
```

(drop `addGithubAccount` from the picker import). In `activate`, after `github`, create the provider; `pickerDeps` is only used inside callbacks, so declaring it afterwards is fine:

```ts
  const gitlab = new GitlabProvider({
    post: fetchPostForm,
    get: fetchGitlab,
    secrets: { get: id => store.getSecret(id), set: (id, value) => store.setSecret(id, value) },
    clientIdFor: host => {
      const cfg = vscode.workspace.getConfiguration('null-accounts.gitlab');
      return resolveClientId(host, cfg.get('clientId'), cfg.get('hostClientIds'));
    },
    now: Date.now,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    onNeedsReauth: account => {
      void vscode.window
        .showWarningMessage(`Your GitLab sign-in for ${account.username}@${account.host} has expired.`, 'Re-authenticate')
        .then(choice => { if (choice) { return reauthenticate(pickerDeps, account.id); } });
    },
    promptReauth: account => reauthenticate(pickerDeps, account.id),
  });
```

Extend the change wiring and the picker deps:

```ts
  context.subscriptions.push(
    store.onDidChange(() => {
      void bindings.prune(new Set(store.list().map(a => a.id)));
      changed.fire();
    }),
    bindings.onDidChange(() => changed.fire()),
    gitlab.onDidChange(() => changed.fire()),
  );

  const pickerDeps: PickerDeps = { accounts: store, bindings, github, gitlab };
```

Token providers, panel and add command:

```ts
    tokenProviders: { github, gitlab },
```

```ts
      AccountsPanel.createOrShow({
        accounts: store,
        bindings,
        add: () => addAccount(pickerDeps),
        reauth: id => reauthenticate(pickerDeps, id),
        needsReauth: id => gitlab.needsReauth(id),
        onDidChange: changed.event,
      })),
```

```ts
    vscode.commands.registerCommand(ADD_ACCOUNT_COMMAND, async () => { await addAccount(pickerDeps); }),
```

Also update the command title in `package.json`: no change needed (`Null Accounts: Add Account` already provider-neutral).

- [ ] **Step 6: Run everything**

Run: `npm --prefix extensions/null-accounts test`
Expected: PASS (`tsc` clean, all suites green including the settings guard).

- [ ] **Step 7: Commit**

```bash
git add extensions/null-accounts/src extensions/null-accounts/package.json
git commit -m "feat: add GitLab accounts to null-accounts (device-flow sign-in, re-auth, settings)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs and compiled output

**Files:**
- Modify: `CLAUDE.md` (the `null-accounts` section)
- Modify: `docs/specs/null-accounts-design.md`
- Modify: `extensions/null-accounts/out/` (regenerated)

- [ ] **Step 1: Update `CLAUDE.md`**

In the `### null-accounts` paragraph: replace "`GitLab and git wiring land in later phases.`" with:

```
GitLab accounts (gitlab.com and self-hosted) sign in through an OAuth device flow (`providers/gitlabOAuth.ts` protocol, `providers/gitlab.ts` provider): tokens live in `SecretStorage` as one JSON string, refresh is single-flight, and an account whose sign-in was refused is flagged "needs re-auth" (Accounts panel button + one-time notification). The OAuth application ID comes from `null-accounts.gitlab.clientId` (gitlab.com) or `null-accounts.gitlab.hostClientIds` (self-hosted); both are application-scoped settings. Git wiring lands in a later phase.
```

and change `**Status: GitHub + project binding + UI**` to `**Status: GitHub + GitLab + project binding + UI**`.

- [ ] **Step 2: Update the spec**

In `docs/specs/null-accounts-design.md`: in the `providers/gitlab` bullet, after the sentence ending "…the setting can be overridden for self-hosted instances.", add: ` An OAuth application is registered per instance, so self-hosted hosts get their own ID from \`null-accounts.gitlab.hostClientIds\` (\`{ "<host>": "<id>" }\`); \`clientId\` covers gitlab.com only. Both settings are application-scoped.` In "Delivery phases", append ` — landed (\`docs/plans/null-accounts-phase5-gitlab.md\`)` to item 5.

- [ ] **Step 3: Regenerate the compiled output**

Run: `npm --prefix extensions/null-accounts run compile`

- [ ] **Step 4: Commit docs and compiled output separately**

```bash
git add CLAUDE.md docs/specs/null-accounts-design.md
git commit -m "docs: document null-accounts GitLab support" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git add extensions/null-accounts/out
git commit -m "chore: refresh null-accounts compiled output" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Register the OAuth application and smoke-test against real GitLab

Human steps — the unit tests fake every HTTP call, so this is the first time the code talks to a real GitLab. It also closes the spec's open item (the default client ID).

- [ ] **Step 1 (user): Register the application.** gitlab.com → *Preferences → Applications → Add new application*: name `Null IDE`, **uncheck "Confidential"**, scopes `read_user`, `api`, `write_repository`, and a placeholder redirect URI (`http://127.0.0.1/` — the device flow never uses it, but the form requires one). Copy the *Application ID* (never the secret; a public client has none).

- [ ] **Step 2: Make the ID the default.** In `extensions/null-accounts/package.json` set `"default"` of `null-accounts.gitlab.clientId` to that ID. Run `npm --prefix extensions/null-accounts test`; commit `feat: ship the Null IDE GitLab OAuth client ID as the gitlab.com default`.

- [ ] **Step 3: Sign-in check.** Sync into the local install with the `verify-local` skill (or F5 *Extension Development Host*). Run *Null Accounts: Add Account → GitLab*: the notification shows a code, the browser opens the verification page with it filled in, approving finishes the flow, and the Accounts panel lists `username · gitlab.com · oauth`. Cancel the notification mid-flow: no error toast, no account added. Add a self-hosted host with no `hostClientIds` entry: the error names the setting.

- [ ] **Step 4: Refresh check** (the spec docs show `redirect_uri` on refresh requests; a public device-flow client sends none). Temporarily set `EXPIRY_MARGIN_MS` in `gitlabOAuth.ts` to `7_200_000` and add a throwaway line at the end of `activate()` — `void api.getToken(store.list().find(a => a.provider === 'gitlab')!).then(t => console.log('gitlab token', Boolean(t)))` — so a fresh token counts as expired and the refresh path runs. Expected: `gitlab token true` in the extension host log and a changed stored token. **If GitLab rejects the refresh** (400 mentioning `redirect_uri`), add `redirect_uri` set to the application's registered URI to the refresh form in `refreshTokens` and extend the Task 1 refresh test to assert it. Revert both temporary edits (`git diff` must show neither).

- [ ] **Step 5: Re-auth check.** In the GitLab UI revoke the *Null IDE* authorisation, repeat the Step 4 trigger: expect the "sign-in has expired" notification once, the panel card showing **Re-authenticate**, and the button completing a new device flow that clears the warning.

---

## Self-Review

**Spec coverage** (spec → task): device flow with `interval`/`slow_down` → Task 1; host configurable per account and validated via `/api/v4/version` (https only) → Tasks 2, 5 (`normalizeHost` already rejects `http://`); public client ID setting, overridable for self-hosted → Tasks 2, 5, 7 (with the documented per-host deviation); access-token refresh with rotated pair persisted → Task 2; "needs re-auth" mark + one-time notification + `getToken` returns `undefined`, never throws → Tasks 2, 4, 5; expired/denied device code → clear message, retry → Tasks 1, 5 (`reportFailure`); secrets only in `SecretStorage`, https only, no client secret → Tasks 1, 2 (fetch helpers use `redirect: 'error'`); API `getToken` serving GitLab → Task 5 (`tokenProviders: { github, gitlab }`); "Add GitLab" in the panel, quick-pick and Accounts menu → Tasks 4, 5 (all three call `addAccount`). Intentionally deferred (stated under Global Constraints): git credential approve on refresh (Phase 6), dashboard (Phase 7).

**Placeholder scan:** none — the only "TBD-like" item is the default client ID, which is an explicit human step (Task 7) with `""` as the shipped default until then.

**Type consistency:** `PostForm` / `FormResponse` / `TokenSet` / `DeviceCode` / `OAuthError` are defined once in `gitlabOAuth.ts` and imported by name everywhere; `GitlabDeps.get(host, apiPath, token?)` matches `fetchGitlab` and the test fake; `GitlabProvider.needsReauth(id)` ↔ `PanelDeps.needsReauth(id)` ↔ `buildRows(…, needsReauth)`; `addAccount` / `reauthenticate` names match between `accountPicker.ts`, `extension.ts` and `PanelDeps.add` / `.reauth`.
