import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { main, Deps, realExportFs, realLockIo, realProjectFs } from './cli';
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
    err: (l) => lines.push(l),
    exp: { fs: realExportFs, lock: realLockIo, scriptPath: 'export_asset.py' },
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

// An engine folder with a Build.version and a project holding one asset; `run` plays the export script.
function exportSetup() {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, 'Content'));
  fs.writeFileSync(path.join(dir, 'Content', 'T.uasset'), 'abc');
  const engineRoot = path.join(dir, 'UE');
  fs.mkdirSync(path.join(engineRoot, 'Engine', 'Build'), { recursive: true });
  fs.writeFileSync(path.join(engineRoot, 'Engine', 'Build', 'Build.version'), '{"MajorVersion":5,"MinorVersion":8,"PatchVersion":4}');
  const d = deps(dir);
  d.run = async (plan) => {
    const req = JSON.parse(fs.readFileSync(plan.env!.NULL_UNREAL_REQUEST, 'utf8'));
    const a = req.assets[0];
    const file = path.join(req.outputDir, 'Game', 'T.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      schema: 1, engineVersion: req.engineVersion, sourceMtime: a.sourceMtime, sourceSize: a.sourceSize, package: a.package,
      kind: 'texture', class: 'Texture2D', references: { dependencies: [] }, data: { width: 8, height: 4, compression: 'TC_DEFAULT' }, sidecars: {},
    }));
    fs.writeFileSync(req.manifest, JSON.stringify({ schema: 1, assets: { [a.package]: { status: 'exported' } } }));
    return { code: 0, timedOut: false, seconds: 1 };
  };
  const err: string[] = [];
  d.err = (l) => err.push(l);
  return { dir, engineRoot, d, err };
}

test('export without an asset is a usage error (2)', async () => {
  const d = deps(tempDir());
  assert.equal(await main(['export', '--engine', ROOT], d), 2);
  assert.ok(d.lines.some((l) => l.includes('at least one')));
});

test('export prints one line per asset and the result lines, then serves the second call from the cache', async () => {
  const { dir, engineRoot, d } = exportSetup();
  assert.equal(await main(['export', path.join('Content', 'T.uasset'), '--engine', engineRoot], d), 0);
  assert.ok(d.lines.includes('/Game/T  texture  exported  Texture 8x4, TC_DEFAULT'), d.lines.join('\n'));
  assert.ok(d.lines.some((l) => l.startsWith('null-unreal export: exit 0')));
  assert.ok(d.lines.some((l) => l.startsWith('log: ') && l.includes('export-')));

  d.lines.length = 0;
  assert.equal(await main(['export', path.join(dir, 'Content'), '--engine', engineRoot], d), 0);
  assert.ok(d.lines.includes('/Game/T  texture  cached  Texture 8x4, TC_DEFAULT'));
  assert.ok(d.lines.some((l) => l.includes('served from the cache')));
});

test('export --json puts only the JSON on stdout and the human lines on stderr', async () => {
  const { engineRoot, d, err } = exportSetup();
  assert.equal(await main(['export', path.join('Content', 'T.uasset'), '--json', '--engine', engineRoot], d), 0);
  assert.equal(JSON.parse(d.lines.join('\n')).package, '/Game/T');
  assert.ok(err.some((l) => l.startsWith('/Game/T  texture  exported')));
});

test('export --json of several assets prints an array', async () => {
  const { dir, engineRoot, d } = exportSetup();
  fs.writeFileSync(path.join(dir, 'Content', 'U.uasset'), 'abcd');
  d.run = async (plan) => {
    const req = JSON.parse(fs.readFileSync(plan.env!.NULL_UNREAL_REQUEST, 'utf8'));
    const assets: Record<string, unknown> = {};
    for (const a of req.assets) {
      const file = path.join(req.outputDir, ...a.package.split('/').filter(Boolean)) + '.json';
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({
        schema: 1, engineVersion: req.engineVersion, sourceMtime: a.sourceMtime, sourceSize: a.sourceSize, package: a.package,
        kind: 'generic', class: 'Thing', references: { dependencies: [] }, data: {}, sidecars: {},
      }));
      assets[a.package] = { status: 'exported' };
    }
    fs.writeFileSync(req.manifest, JSON.stringify({ schema: 1, assets }));
    return { code: 0, timedOut: false, seconds: 1 };
  };
  assert.equal(await main(['export', path.join(dir, 'Content'), '--json', '--engine', engineRoot], d), 0);
  assert.deepEqual(JSON.parse(d.lines.join('\n')).map((x: { package: string }) => x.package), ['/Game/T', '/Game/U']);
});

test('an asset outside any Content root is exit 2 with the reason', async () => {
  const { dir, engineRoot, d } = exportSetup();
  fs.writeFileSync(path.join(dir, 'Stray.uasset'), 'x');
  assert.equal(await main(['export', 'Stray.uasset', '--engine', engineRoot], d), 2);
  assert.ok(d.lines.some((l) => l.includes('not a .uasset under')));
});
