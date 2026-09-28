'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { formatApiError } from './githubApi';

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
