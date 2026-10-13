import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { DESCRIPTION, GistIo, HttpReply, createGistStore } from './gistStore';

interface Call { method: string; url: string; headers: Record<string, string>; body?: Record<string, unknown> }

function fake(replies: (HttpReply | Error)[], text: { status: number; body: string } = { status: 200, body: '' }) {
  const calls: Call[] = [];
  const textCalls: { url: string; headers: Record<string, string> }[] = [];
  const queue = [...replies];
  const io: GistIo = {
    json: async (method, url, headers, body) => {
      calls.push({ method, url, headers, body });
      const next = queue.shift();
      if (!next) throw new Error('unexpected request');
      if (next instanceof Error) throw next;
      return next;
    },
    text: async (url, headers) => {
      textCalls.push({ url, headers });
      return text;
    },
  };
  return { io, calls, textCalls };
}

const gist = (files: Record<string, unknown>) => ({ id: 'g1', owner: { login: 'me' }, files });

describe('find', () => {
  it('finds the gist by description and sends the token only as a bearer header', async () => {
    const { io, calls } = fake([{ status: 200, body: [{ id: 'x', description: 'other' }, { id: 'g1', description: DESCRIPTION }] }]);
    const found = await createGistStore(io, 'tok').find();
    assert.deepEqual(found, { ok: true, value: 'g1' });
    assert.equal(calls[0].headers.Authorization, 'Bearer tok');
    assert.match(calls[0].url, /per_page=100&page=1$/);
    assert.equal(JSON.stringify(calls[0].body ?? {}).includes('tok'), false);
  });

  it('returns undefined when there is none, without paging past a short page', async () => {
    const { io, calls } = fake([{ status: 200, body: [] }]);
    assert.deepEqual(await createGistStore(io, 't').find(), { ok: true, value: undefined });
    assert.equal(calls.length, 1);
  });

  it('keeps paging while pages are full', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, description: 'nope' }));
    const { io, calls } = fake([{ status: 200, body: full }, { status: 200, body: [{ id: 'g2', description: DESCRIPTION }] }]);
    assert.deepEqual(await createGistStore(io, 't').find(), { ok: true, value: 'g2' });
    assert.match(calls[1].url, /page=2$/);
  });
});

describe('read', () => {
  it('returns the owner and every file\'s content', async () => {
    const { io } = fake([{ status: 200, body: gist({ 'a.enc': { content: 'A' }, 'manifest.json': { content: 'M' } }) }]);
    assert.deepEqual(await createGistStore(io, 't').read('g1'), {
      ok: true,
      value: { id: 'g1', owner: 'me', files: { 'a.enc': 'A', 'manifest.json': 'M' } },
    });
  });

  it('fetches a truncated file from the raw host without sending the token', async () => {
    const raw = 'https://gist.githubusercontent.com/me/g1/raw/a.enc';
    const { io, textCalls } = fake(
      [{ status: 200, body: gist({ 'a.enc': { truncated: true, raw_url: raw, content: 'cut' }, 'b.enc': { content: 'B' } }) }],
      { status: 200, body: 'FULL' },
    );
    const read = await createGistStore(io, 'secret').read('g1');
    assert.deepEqual(read.ok && read.value.files, { 'a.enc': 'FULL', 'b.enc': 'B' });
    assert.deepEqual(textCalls, [{ url: raw, headers: {} }]);
  });

  it('refuses a truncated file whose URL is not on the raw host', async () => {
    const { io, textCalls } = fake([{ status: 200, body: gist({ 'a.enc': { truncated: true, raw_url: 'https://evil.example/x' } }) }]);
    const read = await createGistStore(io, 't').read('g1');
    assert.equal(read.ok, false);
    assert.equal(textCalls.length, 0);
  });

  it('rejects a body that is not a gist', async () => {
    const { io } = fake([{ status: 200, body: { hello: 'world' } }]);
    const read = await createGistStore(io, 't').read('g1');
    assert.equal(!read.ok && read.kind, 'error');
  });
});

describe('write calls', () => {
  it('creates a secret gist with the description', async () => {
    const { io, calls } = fake([{ status: 201, body: gist({ 'manifest.json': { content: 'M' } }) }]);
    const created = await createGistStore(io, 't').create({ 'manifest.json': 'M' });
    assert.equal(created.ok, true);
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(calls[0].body, { description: DESCRIPTION, public: false, files: { 'manifest.json': { content: 'M' } } });
  });

  it('updates changed files in one PATCH and deletes with null', async () => {
    const { io, calls } = fake([{ status: 200, body: gist({}) }]);
    const updated = await createGistStore(io, 't').update('g 1', { 'a.enc': 'X', 'b.enc': null });
    assert.equal(updated.ok, true);
    assert.equal(calls[0].method, 'PATCH');
    assert.ok(calls[0].url.endsWith('/gists/g%201'));
    assert.deepEqual(calls[0].body, { files: { 'a.enc': { content: 'X' }, 'b.enc': null } });
  });

  it('removes a gist', async () => {
    const { io, calls } = fake([{ status: 204, body: undefined }]);
    assert.equal((await createGistStore(io, 't').remove('g1')).ok, true);
    assert.equal(calls[0].method, 'DELETE');
  });
});

describe('revisions', () => {
  it('lists commits newest first and reads one by sha', async () => {
    const { io, calls } = fake([
      { status: 200, body: [{ version: 'c2', committed_at: '2026-02-01T00:00:00Z' }, { version: 'c1', committed_at: '2026-01-01T00:00:00Z' }] },
      { status: 200, body: gist({ 'a.enc': { content: 'OLD' } }) },
    ]);
    const store = createGistStore(io, 't');
    assert.deepEqual(await store.revisions('g1'), {
      ok: true,
      value: [{ sha: 'c2', date: '2026-02-01T00:00:00Z' }, { sha: 'c1', date: '2026-01-01T00:00:00Z' }],
    });
    const old = await store.readRevision('g1', 'c1');
    assert.deepEqual(old.ok && old.value.files, { 'a.enc': 'OLD' });
    assert.ok(calls[1].url.endsWith('/gists/g1/c1'));
  });
});

describe('failures', () => {
  it('maps 401/403 to auth and mentions the gist scope', async () => {
    for (const status of [401, 403]) {
      const { io } = fake([{ status, body: { message: 'Bad credentials' } }]);
      const r = await createGistStore(io, 't').read('g1');
      assert.equal(!r.ok && r.kind, 'auth');
      assert.match(!r.ok ? r.message : '', /gist/);
      assert.match(!r.ok ? r.message : '', /Bad credentials/);
    }
  });

  it('maps 404 to notFound', async () => {
    const { io } = fake([{ status: 404, body: { message: 'Not Found' } }]);
    const r = await createGistStore(io, 't').read('g1');
    assert.equal(!r.ok && r.kind, 'notFound');
  });

  it('maps a network failure to offline', async () => {
    const { io } = fake([new Error('getaddrinfo ENOTFOUND api.github.com')]);
    const r = await createGistStore(io, 't').read('g1');
    assert.equal(!r.ok && r.kind, 'offline');
    assert.match(!r.ok ? r.message : '', /ENOTFOUND/);
  });

  it('echoes only a short JSON message, never an HTML error page', async () => {
    const { io } = fake([{ status: 500, body: '<html><body>Bad gateway</body></html>' }, { status: 502, body: { message: 'x'.repeat(500) } }]);
    const store = createGistStore(io, 't');
    const html = await store.read('g1');
    assert.equal(!html.ok && html.message, 'GitHub answered HTTP 500.');
    const long = await store.read('g1');
    assert.ok(!long.ok && long.message.length < 260);
  });
});
