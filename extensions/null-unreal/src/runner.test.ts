import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { run } from './runner';
import { Plan } from './commandLine';

// A sink that collects everything written to it.
function collector(): { sink: NodeJS.WritableStream; text: () => string } {
  let buf = '';
  const sink = new Writable({
    write(chunk, _enc, cb) {
      buf += String(chunk);
      cb();
    },
  });
  return { sink, text: () => buf };
}

function node(script: string, timeoutSec?: number): Plan {
  return { exe: process.execPath, args: ['-e', script], timeoutSec };
}

test('an exit code passes through and output reaches the sink', async () => {
  const c = collector();
  const r = await run(node('process.stdout.write("hello"); process.exit(3)'), c.sink, false);
  assert.equal(r.code, 3);
  assert.equal(r.timedOut, false);
  assert.match(c.text(), /hello/);
});

test('a timeout kills the whole tree, including a grandchild', async () => {
  const c = collector();
  // The parent starts a grandchild, reports its pid, then sleeps too.
  const script = `
    const { spawn } = require('child_process');
    const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    console.log('CHILD ' + g.pid);
    setInterval(() => {}, 1000);
  `;
  const r = await run(node(script, 1), c.sink, false);
  assert.equal(r.timedOut, true);

  const pid = Number(/CHILD (\d+)/.exec(c.text())?.[1]);
  assert.ok(pid > 0, 'grandchild pid was reported');
  let alive = true;
  for (let i = 0; i < 20 && alive; i++) {
    try {
      process.kill(pid, 0);
      await new Promise((d) => setTimeout(d, 100));
    } catch {
      alive = false;
    }
  }
  assert.equal(alive, false, 'grandchild must be gone after the timeout');
});

test('a nonexistent executable resolves with a null code instead of throwing', async () => {
  const c = collector();
  const r = await run({ exe: 'C:\\no\\such\\engine.exe', args: [], timeoutSec: undefined }, c.sink, false);
  assert.equal(r.code, null);
  assert.equal(r.timedOut, false);
});
