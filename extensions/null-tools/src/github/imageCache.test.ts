'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EXCLUDE_LINE, ensureExcluded, issueImagesDir, mapLimit, resolveImage, withExcludeLine } from './imageCache';
import { MAX_IMAGE_BYTES } from './imageUrls';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const SIGNED = 'https://private-user-images.githubusercontent.com/1/2-3.png';
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'null-img-'));
const git = (cwd: string, ...args: string[]): void => { execFileSync('git', args, { cwd, stdio: 'ignore' }); };

/** A network stand-in that answers with `bytes` and records how often it was asked. */
function stub(bytes: Buffer = PNG, contentType: string | null = 'image/png') {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (plan: { kind: string }) => { calls.push(plan.kind); return { bytes, contentType }; },
  };
}

test('resolveImage downloads once, then serves the cached file, even for a re-signed URL', async () => {
  const root = tmp();
  const net = stub();
  const first = await resolveImage(`${SIGNED}?jwt=AAA`, { root, token: 't', fetch: net.fetch });
  const second = await resolveImage(`${SIGNED}?jwt=BBB`, { root, token: 't', fetch: net.fetch });
  assert.strictEqual(first, second);
  assert.strictEqual(path.dirname(first), issueImagesDir(root));
  assert.deepStrictEqual(fs.readFileSync(first), PNG);
  assert.strictEqual(net.calls.length, 1);
  assert.deepStrictEqual(fs.readdirSync(issueImagesDir(root)), [path.basename(first)]); // no half-written .part left behind
});

test('resolveImage shares one download between simultaneous requests for the same image', async () => {
  const root = tmp();
  const net = stub();
  const [a, b] = await Promise.all([
    resolveImage(`${SIGNED}?jwt=AAA`, { root, token: null, fetch: net.fetch }),
    resolveImage(`${SIGNED}?jwt=BBB`, { root, token: null, fetch: net.fetch }),
  ]);
  assert.strictEqual(a, b);
  assert.strictEqual(net.calls.length, 1);
});

test('resolveImage rejects an HTML page served as an image and writes nothing', async () => {
  const root = tmp();
  await assert.rejects(
    resolveImage('https://github.com/user-attachments/assets/x.png', { root, token: null, fetch: stub(Buffer.from('<html>'), 'text/html').fetch }),
    /Not an image/);
  assert.strictEqual(fs.existsSync(issueImagesDir(root)), false);
});

test('resolveImage rejects a file over the size cap', async () => {
  const root = tmp();
  await assert.rejects(
    resolveImage(SIGNED, { root, token: null, fetch: stub(Buffer.alloc(MAX_IMAGE_BYTES + 1)).fetch }), /larger than/);
  assert.strictEqual(fs.existsSync(issueImagesDir(root)), false);
});

test('resolveImage refuses a URL it must not fetch, without calling the network', async () => {
  const net = stub();
  await assert.rejects(resolveImage('http://example.com/a.png', { root: tmp(), token: 't', fetch: net.fetch }), /Not a fetchable image URL/);
  assert.strictEqual(net.calls.length, 0);
});

test('a failed download is not remembered: the next request tries again', async () => {
  const root = tmp();
  let attempts = 0;
  const flaky = async () => {
    if (attempts++ === 0) throw new Error('offline');
    return { bytes: PNG, contentType: 'image/png' };
  };
  await assert.rejects(resolveImage(SIGNED, { root, token: null, fetch: flaky }), /offline/);
  assert.ok((await resolveImage(SIGNED, { root, token: null, fetch: flaky })).endsWith('.png'));
});

test('mapLimit keeps the order and never runs more than the limit at once', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async n => {
    running++;
    peak = Math.max(peak, running);
    await new Promise(resolve => setTimeout(resolve, 5));
    running--;
    return n * 2;
  });
  assert.deepStrictEqual(out, [2, 4, 6, 8, 10, 12]);
  assert.strictEqual(peak, 2);
  assert.deepStrictEqual(await mapLimit([], 4, async n => n), []);
});

test('withExcludeLine appends the line once, keeping existing text and a trailing newline', () => {
  assert.strictEqual(withExcludeLine('', EXCLUDE_LINE), `${EXCLUDE_LINE}\n`);
  assert.strictEqual(withExcludeLine('# comment\n', EXCLUDE_LINE), `# comment\n${EXCLUDE_LINE}\n`);
  assert.strictEqual(withExcludeLine('# comment', EXCLUDE_LINE), `# comment\n${EXCLUDE_LINE}\n`);
  const done = `a\r\n${EXCLUDE_LINE}\r\n`;
  assert.strictEqual(withExcludeLine(done, EXCLUDE_LINE), done);
});

test('ensureExcluded writes the line once into a repository\'s info/exclude', () => {
  const repo = tmp();
  git(repo, 'init');
  ensureExcluded(repo);
  ensureExcluded(repo);
  const text = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
  assert.strictEqual(text.split('\n').filter(line => line === EXCLUDE_LINE).length, 1);
});

test('ensureExcluded from a linked worktree edits the shared exclude file (.git is a file there)', () => {
  const main = tmp();
  git(main, 'init');
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init');
  const worktree = path.join(tmp(), 'wt');
  git(main, 'worktree', 'add', worktree, '-b', 'wt-branch');
  ensureExcluded(worktree);
  assert.ok(fs.readFileSync(path.join(main, '.git', 'info', 'exclude'), 'utf8').includes(EXCLUDE_LINE));
});

test('ensureExcluded outside a repository does nothing and does not throw', () => {
  assert.doesNotThrow(() => ensureExcluded(tmp()));
});
