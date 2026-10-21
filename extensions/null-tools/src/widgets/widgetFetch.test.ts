import assert from 'node:assert';
import test from 'node:test';
import { ApiError } from '../github/githubApi';
import { classifyError, fetchRepos, FetchDeps } from './widgetFetch';

const issue = (repo: string, n: number) => ({ number: n, title: 't', url: `https://github.com/${repo}/issues/${n}`, updatedAt: '2026-10-21T10:00:00Z',
  repository: { nameWithOwner: repo }, labels: { nodes: [] }, assignees: { nodes: [] } });
const empty = { nodes: [] };

function deps(over: Partial<FetchDeps> = {}): FetchDeps & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  return { calls, token: async () => 'tok', localPaths: () => new Map(),
    graphql: (async (_q: string, vars: Record<string, unknown>) => { calls.push(vars);
      return { assigned: { nodes: [issue('a/b', 1), issue('c/d', 2)] }, mentioned: empty, authored: empty, reviewReq: empty }; }) as FetchDeps['graphql'], ...over };
}

test('no token means every repo is signed_out and nothing is requested', async () => {
  const d = deps({ token: async () => undefined });
  assert.deepStrictEqual(await fetchRepos(d, 'acc', ['a/b', 'c/d']), [{ repo: 'a/b', reason: 'signed_out' }, { repo: 'c/d', reason: 'signed_out' }]);
  assert.strictEqual(d.calls.length, 0);
});

test('one request covers the repos and rows are split back per repo (case-insensitive)', async () => {
  const d = deps();
  const out = await fetchRepos(d, 'acc', ['A/b', 'c/d', 'e/f']);
  assert.strictEqual(d.calls.length, 1);
  assert.strictEqual(d.calls[0].n, 20);
  assert.ok(String(d.calls[0].assigned).startsWith('repo:A/b repo:c/d repo:e/f '));
  assert.deepStrictEqual(out.map(r => [r.repo, 'issues' in r ? r.issues.length : -1]), [['A/b', 1], ['c/d', 1], ['e/f', 0]]);
});

test('a failing chunk marks only its repos; other chunks still succeed', async () => {
  const repos = Array.from({ length: 12 }, (_, i) => `organisation/repository-${i}`);
  let n = 0;
  const d = deps({ graphql: (async () => { if (n++ === 0) throw new ApiError('boom', 500); return { assigned: empty, mentioned: empty, authored: empty, reviewReq: empty }; }) as FetchDeps['graphql'] });
  const out = await fetchRepos(d, 'acc', repos);
  assert.ok(out.some(r => 'reason' in r && r.reason === 'error') && out.some(r => 'issues' in r));
  assert.strictEqual(out.length, 12);
});

test('error classification', () => {
  assert.deepStrictEqual(classifyError(new ApiError('Bad credentials', 401)), { reason: 'signed_out', retryAt: null });
  assert.deepStrictEqual(classifyError(new ApiError('rate', 403, 1234)), { reason: 'error', retryAt: 1234 });
  assert.deepStrictEqual(classifyError(Object.assign(new Error('x'), { code: 'ENOTFOUND' })), { reason: 'offline', retryAt: null });
  assert.deepStrictEqual(classifyError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })), { reason: 'offline', retryAt: null });
  assert.deepStrictEqual(classifyError(new Error('whatever')), { reason: 'error', retryAt: null });
});
