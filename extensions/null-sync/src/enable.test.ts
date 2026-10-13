import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CANCELLED, EnableDeps, EnablePrompts, enable } from './enable';
import { FakeGist } from './fakeGist';
import { MANIFEST } from './layout';
import { FirstSync, StoredState, SyncAccount } from './types';

const PASS = 'correct horse battery staple';
const ME: SyncAccount = { id: 'acc', username: 'me' };

function setup(gist: FakeGist, over: Partial<EnableDeps> = {}, prompts: Partial<EnablePrompts> = {}) {
  const saved: { passphrase?: string; state?: StoredState } = {};
  const asked: { attempts: number[]; consent?: string[] } = { attempts: [] };
  const deps: EnableDeps = {
    accounts: async () => [ME],
    token: async () => 'token',
    io: gist.io,
    categories: () => ['settings', 'keybindings', 'snippets'],
    savePassphrase: async (p) => { saved.passphrase = p; },
    setState: async (s) => { saved.state = s; },
    ...over,
  };
  const ui: EnablePrompts = {
    chooseAccount: async (accounts) => accounts[0],
    consent: async (categories) => { asked.consent = categories; return true; },
    newPassphrase: async () => PASS,
    existingPassphrase: async (attempt) => { asked.attempts.push(attempt); return PASS; },
    firstSync: async () => 'each',
    ...prompts,
  };
  return { deps, ui, saved, asked };
}

describe('enable', () => {
  it('needs a github.com account', async () => {
    const { deps, ui } = setup(new FakeGist(), { accounts: async () => [] });
    const result = await enable(deps, ui);
    assert.equal(!result.ok && /Add a GitHub account/.test(result.message), true);
  });

  it('creates the store on the first device and remembers the passphrase and the gist', async () => {
    const gist = new FakeGist();
    const { deps, ui, saved, asked } = setup(gist);
    assert.deepEqual(await enable(deps, ui), { ok: true, firstSync: undefined });
    const [id] = gist.ids();
    assert.deepEqual(Object.keys(gist.files(id)), [MANIFEST]);
    assert.deepEqual(saved.state, { gistId: id, accountId: 'acc', owner: 'me', base: {} });
    assert.equal(saved.passphrase, PASS);
    assert.deepEqual(asked.consent, ['settings', 'keybindings', 'snippets']);
  });

  it('cancelling at the consent step creates nothing', async () => {
    const gist = new FakeGist();
    const { deps, ui, saved } = setup(gist, {}, { consent: async () => false });
    assert.deepEqual(await enable(deps, ui), { ok: false, message: CANCELLED });
    assert.equal(gist.ids().length, 0);
    assert.equal(saved.state, undefined);
  });

  it('fails clearly when GitHub gives no token', async () => {
    const { deps, ui } = setup(new FakeGist(), { token: async () => undefined });
    const result = await enable(deps, ui);
    assert.equal(!result.ok && /gist scope/.test(result.message), true);
  });

  it('asks which account when there are several', async () => {
    const other: SyncAccount = { id: 'acc2', username: 'work' };
    const { deps, ui, saved } = setup(new FakeGist(), { accounts: async () => [ME, other] }, {
      chooseAccount: async (accounts) => accounts[1],
    });
    assert.equal((await enable(deps, ui)).ok, true);
    assert.equal(saved.state?.accountId, 'acc2');
  });

  it('joins an existing store with the right passphrase, trying again after a wrong one', async () => {
    const gist = new FakeGist();
    assert.equal((await enable(setup(gist).deps, setup(gist).ui)).ok, true);
    const { deps, ui, saved, asked } = setup(gist, {}, {
      existingPassphrase: async (attempt) => { asked.attempts.push(attempt); return attempt === 1 ? 'a wrong passphrase!' : PASS; },
    });
    assert.deepEqual(await enable(deps, ui), { ok: true, firstSync: undefined });
    assert.deepEqual(asked.attempts, [1, 2]);
    assert.equal(saved.passphrase, PASS);
  });

  it('gives up after three wrong passphrases and saves nothing', async () => {
    const gist = new FakeGist();
    assert.equal((await enable(setup(gist).deps, setup(gist).ui)).ok, true);
    const { deps, ui, saved, asked } = setup(gist, {}, {
      existingPassphrase: async (attempt) => { asked.attempts.push(attempt); return 'a wrong passphrase!'; },
    });
    const result = await enable(deps, ui);
    assert.equal(!result.ok && /not the passphrase/.test(result.message), true);
    assert.deepEqual(asked.attempts, [1, 2, 3]);
    assert.deepEqual(saved, {});
  });

  it('asks how to resolve the first sync only when the store already has data', async () => {
    const gist = new FakeGist();
    assert.equal((await enable(setup(gist).deps, setup(gist).ui)).ok, true);
    let asks = 0;
    const empty = setup(gist, {}, { firstSync: async () => { asks++; return 'cloud'; } });
    assert.deepEqual(await enable(empty.deps, empty.ui), { ok: true, firstSync: undefined });
    assert.equal(asks, 0, 'a store with only a manifest has nothing to resolve');

    gist.tamper(gist.ids()[0], 'settings.json.enc', 'x');
    for (const [choice, expected] of [['cloud', 'cloud'], ['device', 'device'], ['each', undefined]] as [FirstSync | 'each', FirstSync | undefined][]) {
      const s = setup(gist, {}, { firstSync: async () => choice });
      assert.deepEqual(await enable(s.deps, s.ui), { ok: true, firstSync: expected }, choice);
    }
  });

  it('cancelling the first-sync question saves nothing', async () => {
    const gist = new FakeGist();
    assert.equal((await enable(setup(gist).deps, setup(gist).ui)).ok, true);
    gist.tamper(gist.ids()[0], 'settings.json.enc', 'x');
    const { deps, ui, saved } = setup(gist, {}, { firstSync: async () => undefined });
    assert.deepEqual(await enable(deps, ui), { ok: false, message: CANCELLED });
    assert.deepEqual(saved, {});
  });
});
