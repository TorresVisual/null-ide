'use strict';

import { EventEmitter } from 'node:events';
import https from 'node:https';
import { mock } from 'node:test';

export interface Call { url: string; method: string; body?: any }
export interface Canned { status?: number; body: unknown }

/** Answers each https.request with the next canned response (the last one repeats) and records what was asked. */
export function stub(responses: Canned[]): Call[] {
  const calls: Call[] = [];
  mock.method(https, 'request', (url: string, opts: { method: string }, onResponse: (res: unknown) => void) => {
    const call: Call = { url, method: opts.method };
    calls.push(call);
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return Object.assign(new EventEmitter(), {
      setTimeout() {}, destroy() {},
      write(payload: string) { call.body = JSON.parse(payload); },
      end() {
        const res = Object.assign(new EventEmitter(), { statusCode: next.status ?? 200, headers: {}, setEncoding() {} });
        onResponse(res);
        res.emit('data', JSON.stringify(next.body));
        res.emit('end');
      },
    });
  });
  return calls;
}
