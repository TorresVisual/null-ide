import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { main, Deps, realProjectFs } from './cli';
import { Plan } from './commandLine';

const ROOT = 'C:\\UE';

function tempDir(files: string[] = ['MyGame.uproject']): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-unreal-cli-'));
  for (const f of files) fs.writeFileSync(path.join(dir, f), '{"EngineAssociation":"5.8"}');
  return dir;
}

// Fake engine: every path "exists", so --engine always resolves.
const engineFound = { registry: () => undefined, readFile: () => undefined, exists: () => true };

function deps(cwd: string, o: { result?: Partial<{ code: number | null; timedOut: boolean; seconds: number }>; engine?: typeof engineFound; plans?: Plan[] } = {}) {
  const lines: string[] = [];
  const d: Deps & { lines: string[] } = {
    cwd,
    project: realProjectFs,
    engine: o.engine ?? engineFound,
    run: async (plan) => {
      o.plans?.push(plan);
      return { code: 0, timedOut: false, seconds: 1, ...o.result };
    },
    now: () => new Date(2026, 0, 2, 3, 4, 5),
    out: (l) => lines.push(l),
    lines,
  };
  return d;
}

test('the engine exit code passes through', async () => {
  const d = deps(tempDir(), { result: { code: 3 } });
  assert.equal(await main(['smoke', '--engine', ROOT], d), 3);
  assert.ok(d.lines.some((l) => l.startsWith('null-unreal smoke: exit 3')));
});

test('a timeout returns 124', async () => {
  const d = deps(tempDir(), { result: { code: null, timedOut: true } });
  assert.equal(await main(['smoke', '--engine', ROOT], d), 124);
});

test('a process killed by a signal returns 255, never 0', async () => {
  const d = deps(tempDir(), { result: { code: null } });
  assert.equal(await main(['build', '--engine', ROOT], d), 255);
});

test('an unknown command is a usage error (2)', async () => {
  const d = deps(tempDir());
  assert.equal(await main(['bogus'], d), 2);
  assert.ok(d.lines.some((l) => l.includes('usage')));
});

test('no .uproject in the given directory is a resolution error (2) naming --project', async () => {
  const empty = tempDir([]);
  const d = deps(empty);
  assert.equal(await main(['smoke', '--project', empty, '--engine', ROOT], d), 2);
  assert.ok(d.lines.some((l) => l.includes('--project')));
});

test('two .uproject files in one directory is a resolution error (2) listing both', async () => {
  const two = tempDir(['A.uproject', 'B.uproject']);
  const d = deps(two);
  assert.equal(await main(['smoke', '--project', two, '--engine', ROOT], d), 2);
  assert.ok(d.lines.some((l) => l.includes('A.uproject') && l.includes('B.uproject')));
});

test('a missing engine is a resolution error (2) with the actionable message', async () => {
  const dir = tempDir();
  const d = deps(dir, { engine: { registry: () => undefined, readFile: () => undefined, exists: () => false } });
  assert.equal(await main(['smoke', '--project', dir], d), 2);
  assert.ok(d.lines.some((l) => l.includes('could not find Unreal Engine')));
});

test('arguments after -- are appended after the defaults, and --timeout overrides the timeout', async () => {
  const plans: Plan[] = [];
  const d = deps(tempDir(), { plans });
  await main(['smoke', '--engine', ROOT, '--timeout', '7', '--', '-LogCmds=Foo'], d);
  assert.equal(plans[0].args[plans[0].args.length - 1], '-LogCmds=Foo');
  assert.equal(plans[0].timeoutSec, 7);
});

test('a run opens its log in Saved/NullUnreal and prints the path', async () => {
  const dir = tempDir();
  const d = deps(dir);
  await main(['smoke', '--engine', ROOT], d);
  const logPath = path.join(dir, 'Saved', 'NullUnreal', 'smoke-20260102-030405.log');
  assert.ok(fs.existsSync(logPath), 'log file exists');
  assert.ok(d.lines.includes(`log: ${logPath}`));
});
