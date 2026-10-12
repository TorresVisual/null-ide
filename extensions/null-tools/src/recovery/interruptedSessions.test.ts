import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { classifyLastTurn, firstPromptTitle, scanSessions } from './interruptedSessions';

const asst = (stop: string | null, extra: object = {}) =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', stop_reason: stop, content: [{ type: 'text', text: 'ok' }] }, ...extra });
const user = (content: unknown, extra: object = {}) =>
  JSON.stringify({ type: 'user', message: { role: 'user', content }, ...extra });
const lines = (...l: string[]) => l.join('\n') + '\n';

test('a transcript ending in an assistant end_turn is completed', () => {
  assert.equal(classifyLastTurn(lines(user('hi'), asst('end_turn'))), 'completed');
});

test('a transcript ending in an assistant tool_use is interrupted', () => {
  assert.equal(classifyLastTurn(lines(user('hi'), asst('tool_use'))), 'interrupted');
  assert.equal(classifyLastTurn(lines(user('hi'), asst(null))), 'interrupted');
});

test('a transcript ending in a user entry (prompt or tool result) is interrupted', () => {
  assert.equal(classifyLastTurn(lines(asst('end_turn'), user('next question'))), 'interrupted');
  assert.equal(classifyLastTurn(lines(asst('tool_use'), user([{ type: 'tool_result', content: 'x' }]))), 'interrupted');
});

test('a user-initiated interrupt is a deliberate stop, not a crash', () => {
  const stop = user([{ type: 'text', text: '[Request interrupted by user]' }]);
  assert.equal(classifyLastTurn(lines(asst('tool_use'), stop)), 'completed');
});

test('a torn final line is skipped and the previous turn decides', () => {
  assert.equal(classifyLastTurn(lines(user('hi'), asst('end_turn')) + '{"type":"assis'), 'completed');
  assert.equal(classifyLastTurn(lines(user('hi'), asst('tool_use')) + '{"type":"assis'), 'interrupted');
});

test('non-conversation, sidechain and meta entries are ignored', () => {
  const noise = [
    JSON.stringify({ type: 'attachment' }),
    asst('tool_use', { isSidechain: true }),
    user('meta text', { isMeta: true }),
  ];
  assert.equal(classifyLastTurn(lines(user('hi'), asst('end_turn'), ...noise)), 'completed');
});

test('a transcript with no conversation entries is unknown', () => {
  assert.equal(classifyLastTurn(''), 'unknown');
  assert.equal(classifyLastTurn(lines(JSON.stringify({ type: 'summary' }))), 'unknown');
});

test('firstPromptTitle skips wrappers, tool results and meta, and truncates', () => {
  const head = lines(
    user('<command-name>/clear</command-name>'),
    user([{ type: 'tool_result', content: 'x' }]),
    user('real   question\nabout things', { isMeta: false }),
  );
  assert.equal(firstPromptTitle(head), 'real question about things');
  assert.equal(firstPromptTitle(lines(user('x'.repeat(200))))?.length, 80);
  assert.equal(firstPromptTitle(lines(asst('end_turn'))), undefined);
  assert.equal(firstPromptTitle(user([{ type: 'text', text: 'array form' }])), 'array form');
});

function transcript(dir: string, id: string, body: string, mtimeMs: number): void {
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, body);
  fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
}

test('scanSessions keeps transcripts in [from, until), newest first, with state and title', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-recovery-sessions-'));
  try {
    const T = Date.parse('2026-01-01T00:00:00Z');
    transcript(dir, 'before', lines(user('old'), asst('end_turn')), T - 5000);
    transcript(dir, 'done', lines(user('finished work'), asst('end_turn')), T + 1000);
    transcript(dir, 'cut', lines(user('long task'), asst('tool_use')), T + 2000);
    transcript(dir, 'live', lines(user('another window'), asst('tool_use')), T + 9000); // written after this window started
    transcript(dir, 'empty', '', T + 1500);
    transcript(dir, 'notes', lines(JSON.stringify({ type: 'summary' })), T + 1600);
    fs.writeFileSync(path.join(dir, 'readme.txt'), 'not a transcript');

    assert.deepEqual(scanSessions(dir, T, T + 5000), [
      { sessionId: 'cut', title: 'long task', lastActivity: T + 2000, interrupted: true },
      { sessionId: 'done', title: 'finished work', lastActivity: T + 1000, interrupted: false },
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scanSessions on a missing directory returns an empty list', () => {
  assert.deepEqual(scanSessions(path.join(os.tmpdir(), 'null-recovery-nope'), 0, 1), []);
});
