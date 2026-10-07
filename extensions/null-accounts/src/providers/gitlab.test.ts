'use strict';

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
    replies: [{ body: { ...device.body as object, verification_uri: 'https://git.example.org:8443/oauth/device' } }, granted],
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

test('GitLab client IDs are application-scoped, so a workspace cannot swap in its own OAuth app', () => {
  const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  for (const key of ['null-accounts.gitlab.clientId', 'null-accounts.gitlab.hostClientIds']) {
    assert.strictEqual(pkg.contributes.configuration.properties[key]?.scope, 'application', key);
  }
});
