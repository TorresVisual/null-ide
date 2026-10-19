'use strict';

import { EventEmitter } from 'node:events';
import https from 'node:https';
import { mock } from 'node:test';

export interface Call { url: string; method: string; headers: Record<string, string>; body?: any }
/** `raw` is sent as-is (use '' for an empty body); otherwise `body` is JSON-encoded. */
export interface Canned { status?: number; body?: unknown; raw?: string; headers?: Record<string, string> }

/** Answers each https.request with the next canned response (the last one repeats) and records what was asked. */
export function stub(responses: Canned[]): Call[] {
  const calls: Call[] = [];
  mock.method(https, 'request', (url: string, opts: { method: string; headers?: Record<string, string> }, onResponse: (res: unknown) => void) => {
    const call: Call = { url, method: opts.method, headers: opts.headers ?? {} };
    calls.push(call);
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return Object.assign(new EventEmitter(), {
      setTimeout() {}, destroy() {},
      write(payload: string) { call.body = JSON.parse(payload); },
      end() {
        const res = Object.assign(new EventEmitter(), { statusCode: next.status ?? 200, headers: next.headers ?? {}, setEncoding() {} });
        onResponse(res);
        const text = next.raw ?? JSON.stringify(next.body);
        if (text) res.emit('data', text);
        res.emit('end');
      },
    });
  });
  return calls;
}
