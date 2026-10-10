'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { BadgeAccount, BadgePublisher, PublishedState } from '../badgePublisher';
import { HttpJson } from '../gistClient';
import { DailyStat, LanguageStat } from '../types';

const MIN = 60_000;
const alice: BadgeAccount = { id: 'a1', username: 'alice' };
const bob: BadgeAccount = { id: 'b1', username: 'bob' };

interface Options {
  accounts?: BadgeAccount[];
  token?: string | undefined;
  tokenError?: boolean;
  state?: PublishedState;
  choose?: BadgeAccount;
  gate?: Promise<void>;
}

function setup(over: Options = {}) {
  const calls: Array<{ method: string; url: string; body: Record<string, any> }> = [];
  const days: DailyStat[] = [{ day: '2026-10-08', ms: 60 * MIN }];
  const languages: LanguageStat[] = [{ language: 'typescript', ms: 60 * MIN }];
  const tokenAsked: boolean[] = [];
  let state = over.state;
  const http: HttpJson = async (method, url, _headers, body) => {
    calls.push({ method, url, body });
    if (over.gate && calls.length === 1) await over.gate;
    return { status: method === 'POST' ? 201 : 200, body: { id: 'g1', owner: { login: 'alice' } } };
  };
  const publisher = new BadgePublisher({
    source: { getDailyStats: () => days, getLanguageStats: () => languages },
    accounts: async () => over.accounts ?? [alice],
    chooseAccount: async () => over.choose,
    token: async (_id, interactive) => {
      tokenAsked.push(interactive);
      if (over.tokenError) throw new Error('keychain locked');
      return 'token' in over ? over.token : 'tok';
    },
    http,
    state: { get: () => state, set: (s) => { state = s; } },
  });
  return { publisher, calls, days, tokenAsked, getState: () => state };
}

test('first manual publish creates a secret gist, remembers it and returns README markdown', async () => {
  const t = setup();
  const out = await t.publisher.publish({ interactive: true });
  if (!out.ok) throw new Error(out.message);
  assert.strictEqual(t.calls.length, 1);
  assert.strictEqual(t.calls[0].method, 'POST');
  assert.strictEqual(t.calls[0].body.public, false);
  assert.deepStrictEqual(Object.keys(t.calls[0].body.files), [
    'null-activity-total.svg', 'null-activity-daily-average.svg', 'null-activity-top-language.svg',
  ]);
  assert.strictEqual(t.getState()?.gistId, 'g1');
  assert.strictEqual(t.getState()?.accountId, 'a1');
  const lines = out.markdown.split('\n');
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(lines[0], '![coding time](https://gist.githubusercontent.com/alice/g1/raw/null-activity-total.svg)');
});

test('no GitHub account: a message, and GitHub is not called', async () => {
  const t = setup({ accounts: [] });
  const out = await t.publisher.publish({ interactive: true });
  assert.strictEqual(out.ok, false);
  assert.match((out as { message: string }).message, /GitHub account/);
  assert.strictEqual(t.calls.length, 0);
});

test('auto-refresh never starts publishing and never asks for a token', async () => {
  const t = setup();
  const out = await t.publisher.publish({ interactive: false });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(t.calls.length, 0);
  assert.deepStrictEqual(t.tokenAsked, []);
});

test('auto-refresh skips unchanged badges and updates changed ones, silently', async () => {
  const t = setup();
  await t.publisher.publish({ interactive: true });
  const same = await t.publisher.publish({ interactive: false });
  assert.deepStrictEqual(same.ok && same.changed, false);
  assert.strictEqual(t.calls.length, 1);

  t.days[0].ms = 120 * MIN;
  const changed = await t.publisher.publish({ interactive: false });
  assert.deepStrictEqual(changed.ok && changed.changed, true);
  assert.strictEqual(t.calls.length, 2);
  assert.strictEqual(t.calls[1].method, 'PATCH');
  assert.ok(t.calls[1].url.endsWith('/gists/g1'));
  assert.strictEqual(t.tokenAsked[t.tokenAsked.length - 1], false);
});

test('a manual publish always pushes, even when nothing changed', async () => {
  const t = setup();
  await t.publisher.publish({ interactive: true });
  await t.publisher.publish({ interactive: true });
  assert.deepStrictEqual(t.calls.map((c) => c.method), ['POST', 'PATCH']);
});

test('no token, or a token provider that throws: a failure, GitHub not called', async () => {
  const none = setup({ token: undefined });
  assert.strictEqual((await none.publisher.publish({ interactive: true })).ok, false);
  assert.strictEqual(none.calls.length, 0);

  const broken = setup({ tokenError: true });
  const out = await broken.publisher.publish({ interactive: true });
  assert.strictEqual(out.ok, false);
  assert.match((out as { message: string }).message, /keychain locked/);
  assert.strictEqual(broken.calls.length, 0);
});

test('several accounts: asks which one; cancelling stops, choosing remembers it', async () => {
  const cancelled = setup({ accounts: [alice, bob] });
  assert.strictEqual((await cancelled.publisher.publish({ interactive: true })).ok, false);
  assert.strictEqual(cancelled.calls.length, 0);

  const chosen = setup({ accounts: [alice, bob], choose: bob });
  assert.strictEqual((await chosen.publisher.publish({ interactive: true })).ok, true);
  assert.strictEqual(chosen.getState()?.accountId, 'b1');
});

test('the remembered account is used without asking; a removed account starts over with a new gist', async () => {
  const remembered = setup({ accounts: [alice, bob], state: { gistId: 'g1', accountId: 'b1', owner: 'bob', hash: 'old' } });
  await remembered.publisher.publish({ interactive: true });
  assert.strictEqual(remembered.calls[0].method, 'PATCH');

  const removed = setup({ accounts: [alice], state: { gistId: 'old', accountId: 'gone', owner: 'x', hash: 'old' } });
  await removed.publisher.publish({ interactive: true });
  assert.strictEqual(removed.calls[0].method, 'POST');
  assert.strictEqual(removed.getState()?.accountId, 'a1');
});

test('publishes are serialised: a second call waits for the first', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const t = setup({ gate });
  const first = t.publisher.publish({ interactive: true });
  const second = t.publisher.publish({ interactive: true });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(t.calls.length, 1);
  release();
  await Promise.all([first, second]);
  assert.deepStrictEqual(t.calls.map((c) => c.method), ['POST', 'PATCH']);
});
