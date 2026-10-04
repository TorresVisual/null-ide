'use strict';

import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import test, { afterEach, mock } from 'node:test';
import { ApiError, formatApiError, rateLimitRetryAt, requestGraphql } from './githubApi';

afterEach(() => mock.restoreAll());

test('formatApiError: REST validation error lists each field error', () => {
  const body = JSON.stringify({
    message: 'Validation Failed',
    errors: [{ resource: 'Issue', code: 'invalid', field: 'assignees' }],
  });
  assert.strictEqual(formatApiError(422, body), 'GitHub API 422: Validation Failed · assignees invalid');
});

test("formatApiError: prefers an error entry's own message", () => {
  const body = JSON.stringify({
    message: 'Validation Failed',
    errors: [{ message: "Could not resolve to a User with the login of 'ghost'." }],
  });
  assert.strictEqual(
    formatApiError(422, body),
    "GitHub API 422: Validation Failed · Could not resolve to a User with the login of 'ghost'.",
  );
});

test('formatApiError: plain message, documentation_url ignored', () => {
  const body = JSON.stringify({ message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest' });
  assert.strictEqual(formatApiError(401, body), 'GitHub API 401: Bad credentials');
});

test('formatApiError: string entries in errors[]', () => {
  const body = JSON.stringify({ message: 'Validation Failed', errors: ['title is too long'] });
  assert.strictEqual(formatApiError(422, body), 'GitHub API 422: Validation Failed · title is too long');
});

test('formatApiError: GraphQL errors on a 200 response', () => {
  const body = JSON.stringify({ errors: [{ message: "Field 'foo' doesn't exist on type 'Issue'" }] });
  assert.strictEqual(formatApiError(200, body), "GitHub API error: Field 'foo' doesn't exist on type 'Issue'");
});

test('formatApiError: non-JSON body (proxy HTML) shows only the status', () => {
  assert.strictEqual(formatApiError(502, '<html><body>Bad gateway</body></html>'), 'GitHub API 502');
});

test('formatApiError: empty or null body', () => {
  assert.strictEqual(formatApiError(404, ''), 'GitHub API 404');
  assert.strictEqual(formatApiError(500, 'null'), 'GitHub API 500');
});

/** Makes https.request answer with a canned response, so requestGraphql can be tested without the network. */
function stubGitHub(status: number, body: string, headers: Record<string, string> = {}): void {
  mock.method(https, 'request', (_url: unknown, _opts: unknown, onResponse: (res: unknown) => void) => {
    const req = Object.assign(new EventEmitter(), {
      setTimeout() {}, write() {}, destroy() {},
      end() {
        const res = Object.assign(new EventEmitter(), { statusCode: status, headers, setEncoding() {} });
        onResponse(res);
        res.emit('data', body);
        res.emit('end');
      },
    });
    return req;
  });
}

test('requestGraphql resolves to data', async () => {
  stubGitHub(200, JSON.stringify({ data: { viewer: { login: 'octocat' } } }));
  assert.deepStrictEqual(await requestGraphql('query{viewer{login}}', {}, 't'), { viewer: { login: 'octocat' } });
});

test('requestGraphql rejects on errors[] even when partial data came back', async () => {
  stubGitHub(200, JSON.stringify({ data: { viewer: null }, errors: [{ message: "Field 'foo' doesn't exist" }] }));
  await assert.rejects(requestGraphql('q', {}, 't'), (err: Error) => {
    assert.ok(err instanceof ApiError);
    assert.strictEqual(err.message, "GitHub API error: Field 'foo' doesn't exist");
    return true;
  });
});

test('requestGraphql: a rate-limit error carries when to retry', async () => {
  stubGitHub(200, JSON.stringify({ errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }), {
    'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000',
  });
  await assert.rejects(requestGraphql('q', {}, 't'), (err: ApiError) => err.retryAt === 1800000000 * 1000);
});

test('requestGraphql: a 401 is an ApiError with its status and no retry time', async () => {
  stubGitHub(401, JSON.stringify({ message: 'Bad credentials' }));
  await assert.rejects(requestGraphql('q', {}, 't'), (err: ApiError) =>
    err.status === 401 && err.retryAt === null && err.message === 'GitHub API 401: Bad credentials');
});

test('requestGraphql: a secondary rate limit (403 + retry-after) carries a retry time', async () => {
  stubGitHub(403, JSON.stringify({ message: 'You have exceeded a secondary rate limit' }), { 'retry-after': '30' });
  const before = Date.now();
  await assert.rejects(requestGraphql('q', {}, 't'), (err: ApiError) =>
    err.retryAt !== null && err.retryAt >= before + 30000 && err.retryAt < before + 31000);
});

test('rateLimitRetryAt: Retry-After wins, then the reset time, else null', () => {
  assert.strictEqual(rateLimitRetryAt({ 'retry-after': '60' }, 1000), 61000);
  assert.strictEqual(rateLimitRetryAt({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000' }), 2000000);
  assert.strictEqual(rateLimitRetryAt({ 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': '2000' }), null);
  assert.strictEqual(rateLimitRetryAt({}), null);
});
