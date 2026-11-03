import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { entryPath } from './cache';
import { realExportFs, realLockIo } from './cli';
import { Plan } from './commandLine';
import { Engine } from './engine';
import { classifyEngineFailure, ExportDeps, exportAssets, ExportOptions, MAX_PER_RUN } from './exporter';
import { Request } from './exportFormat';
import { RunResult } from './runner';

// A project with n assets A0..A(n-1) under Content, and a fake engine folder with a Build.version.
function setup(n = 2) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'null-unreal-export-'));
  const project = { file: path.join(root, 'G.uproject'), dir: root, name: 'G', engineAssociation: '5.8' };
  fs.mkdirSync(path.join(root, 'Content'), { recursive: true });
  const files: string[] = [];
  for (let i = 0; i < n; i++) {
    files.push(path.join(root, 'Content', `A${i}.uasset`));
    fs.writeFileSync(files[i], 'x'.repeat(10 + i));
  }
  const engineRoot = path.join(root, 'UE');
  fs.mkdirSync(path.join(engineRoot, 'Engine', 'Build'), { recursive: true });
  fs.writeFileSync(path.join(engineRoot, 'Engine', 'Build', 'Build.version'), '{"MajorVersion":5,"MinorVersion":8,"PatchVersion":4}');
  const engine: Engine = { root: engineRoot, editor: 'e', editorCmd: 'ec', automationTool: 'at', buildTool: 'ubt' };
  return { root, project, engine, files };
}

const ok: RunResult = { code: 0, timedOut: false, seconds: 1 };

// What the exporter script does for one asset, so the cache entry looks real.
function writeExport(req: Request, pkg: string) {
  const a = req.assets.find((x) => x.package === pkg)!;
  const file = entryPath(req.outputDir, pkg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    schema: 1, engineVersion: req.engineVersion, sourceMtime: a.sourceMtime, sourceSize: a.sourceSize, package: pkg,
    kind: 'texture', class: 'Texture2D', references: { dependencies: [] }, data: { width: 1, height: 1 }, sidecars: {},
  }));
}

type Behaviour = (req: Request, plan: Plan, call: number) => { manifest?: Record<string, unknown>; result?: RunResult };

function deps(root: string, behave: Behaviour, calls: Request[] = []): ExportDeps {
  return {
    fs: realExportFs,
    lock: realLockIo,
    now: () => new Date(2026, 0, 2, 3, 4, 5),
    scriptPath: 'export_asset.py',
    run: async (plan, sink) => {
      const req: Request = JSON.parse(fs.readFileSync(plan.env!.NULL_UNREAL_REQUEST, 'utf8'));
      calls.push(req);
      sink?.write('engine output\n');
      const b = behave(req, plan, calls.length);
      if (b.manifest) fs.writeFileSync(req.manifest, JSON.stringify({ schema: 1, assets: b.manifest }));
      return b.result ?? ok;
    },
  };
}

const exportsAll: Behaviour = (req) => {
  const manifest: Record<string, unknown> = {};
  for (const a of req.assets) {
    writeExport(req, a.package);
    manifest[a.package] = { status: 'exported' };
  }
  return { manifest };
};

const opts = (s: ReturnType<typeof setup>, over: Partial<ExportOptions> = {}): ExportOptions => ({
  project: s.project, engine: s.engine, targets: s.files, force: false, extraArgs: [], ...over,
});

test('a miss runs the engine once for the whole batch and the second request is a pure cache hit', async () => {
  const s = setup(3);
  const calls: Request[] = [];
  const first = await exportAssets(opts(s), deps(s.root, exportsAll, calls));
  assert.equal(first.code, 0);
  assert.deepEqual(first.outcomes.map((o) => [o.package, o.status]), [['/Game/A0', 'exported'], ['/Game/A1', 'exported'], ['/Game/A2', 'exported']]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].assets.length, 3);
  assert.equal(calls[0].engineVersion, '5.8.4');

  const second = await exportAssets(opts(s), deps(s.root, exportsAll, calls));
  assert.equal(calls.length, 1, 'no second engine run');
  assert.equal(second.ran, false);
  assert.ok(second.outcomes.every((o) => o.status === 'hit'));
});

test('touching a source file makes only that asset a miss', async () => {
  const s = setup(2);
  const calls: Request[] = [];
  await exportAssets(opts(s), deps(s.root, exportsAll, calls));
  fs.writeFileSync(s.files[1], 'longer than before');
  const r = await exportAssets(opts(s), deps(s.root, exportsAll, calls));
  assert.deepEqual(r.outcomes.map((o) => o.status), ['hit', 'exported']);
  assert.deepEqual(calls[1].assets.map((a) => a.package), ['/Game/A1']);
});

test('--force ignores the cache', async () => {
  const s = setup(1);
  const calls: Request[] = [];
  await exportAssets(opts(s), deps(s.root, exportsAll, calls));
  const r = await exportAssets(opts(s, { force: true }), deps(s.root, exportsAll, calls));
  assert.equal(calls.length, 2);
  assert.equal(r.outcomes[0].status, 'exported');
});

test('a folder expands to its assets', async () => {
  const s = setup(2);
  const calls: Request[] = [];
  await exportAssets(opts(s, { targets: [path.join(s.root, 'Content')] }), deps(s.root, exportsAll, calls));
  assert.equal(calls[0].assets.length, 2);
});

test('more than 50 assets split into runs of at most 50', async () => {
  const s = setup(MAX_PER_RUN + 1);
  const calls: Request[] = [];
  const r = await exportAssets(opts(s), deps(s.root, exportsAll, calls));
  assert.deepEqual(calls.map((c) => c.assets.length), [MAX_PER_RUN, 1]);
  assert.equal(r.code, 0);
});

test('the timeout is 120 s plus 2 s per asset in the run, and --timeout overrides it', async () => {
  const s = setup(3);
  const seen: (number | undefined)[] = [];
  const b: Behaviour = (req, plan) => (seen.push(plan.timeoutSec), exportsAll(req, plan, 1));
  await exportAssets(opts(s), deps(s.root, b));
  await exportAssets(opts(s, { force: true, timeoutSec: 9 }), deps(s.root, b));
  assert.deepEqual(seen, [126, 9]);
});

test('an asset the script failed on is failed with its error and the exit code is 1', async () => {
  const s = setup(2);
  const b: Behaviour = (req) => {
    writeExport(req, '/Game/A0');
    return { manifest: { '/Game/A0': { status: 'exported' }, '/Game/A1': { status: 'failed', error: 'KeyError: x' } } };
  };
  const r = await exportAssets(opts(s), deps(s.root, b));
  assert.equal(r.code, 1);
  assert.deepEqual(r.outcomes.map((o) => [o.status, o.error]), [['exported', undefined], ['failed', 'KeyError: x']]);
});

test('a crash mid-batch keeps what was written, reports the rest not exported, stops and does not retry', async () => {
  const s = setup(MAX_PER_RUN + 2);
  const calls: Request[] = [];
  const b: Behaviour = (req) => {
    writeExport(req, req.assets[0].package);
    return { manifest: { [req.assets[0].package]: { status: 'exported' } }, result: { code: 3, timedOut: false, seconds: 1 } };
  };
  const r = await exportAssets(opts(s), deps(s.root, b, calls));
  assert.equal(calls.length, 1, 'the second chunk is not attempted');
  assert.equal(r.code, 1);
  assert.equal(r.outcomes[0].status, 'exported');
  assert.ok(r.outcomes.slice(1).every((o) => o.status === 'not exported'));
});

test('a timeout returns 124 and says what stays cached', async () => {
  const s = setup(1);
  const r = await exportAssets(opts(s), deps(s.root, () => ({ result: { code: null, timedOut: true, seconds: 5 } })));
  assert.equal(r.code, 124);
  assert.equal(r.timedOut, true);
  assert.match(r.message!, /killed/);
});

test('no manifest is exit 2 with the classification of the log, and the log is kept', async () => {
  const s = setup(1);
  const r = await exportAssets(opts(s), deps(s.root, () => ({ result: { code: 1, timedOut: false, seconds: 1 } })));
  assert.equal(r.code, 2);
  assert.match(r.message!, /null-unreal build/);
  assert.ok(r.logPath && fs.existsSync(r.logPath));
});

test('the request and manifest files are cleaned up after a run', async () => {
  const s = setup(1);
  await exportAssets(opts(s), deps(s.root, exportsAll));
  const left = fs.readdirSync(path.join(s.root, 'Saved', 'NullUnreal')).filter((n) => n.startsWith('export-'));
  assert.deepEqual(left.filter((n) => !n.endsWith('.log')), []);
});

test('a .uasset outside the mounted content roots is an explicit error before any engine run', async () => {
  const s = setup(1);
  const stray = path.join(s.root, 'Stray.uasset');
  fs.writeFileSync(stray, 'x');
  const calls: Request[] = [];
  await assert.rejects(exportAssets(opts(s, { targets: [stray] }), deps(s.root, exportsAll, calls)), /not a \.uasset under/);
  assert.equal(calls.length, 0);
});

test('a missing engine version file is a resolution error', async () => {
  const s = setup(1);
  fs.rmSync(path.join(s.engine.root, 'Engine', 'Build', 'Build.version'));
  await assert.rejects(exportAssets(opts(s), deps(s.root, exportsAll)), /engine version/);
});

test('classifyEngineFailure tells the three causes apart', () => {
  assert.match(classifyEngineFailure('LogInit: Unable to find commandlet class PythonScript', 1), /PythonScriptPlugin/);
  assert.match(classifyEngineFailure('LogPythonScriptCommandlet: Display: Running Python script: x.py', 0), /failed before writing its manifest/);
  assert.match(classifyEngineFailure('LogInit: boot', 1), /exited \(code 1\).*null-unreal build/);
  assert.match(classifyEngineFailure(undefined, null), /killed/);
});
