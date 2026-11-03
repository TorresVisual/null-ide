import { win32 as win } from 'node:path';
import { assetsDir, CacheIo, lookup } from './cache';
import { buildPlan } from './commandLine';
import { Engine } from './engine';
import { ExportDoc, parseManifest, Request, SCHEMA } from './exportFormat';
import { LockIo, withLock } from './lock';
import { openLog, rotate } from './logs';
import { findMounts, toPackagePath, TreeFs, uassetsIn } from './packagePath';
import { run as runEngine } from './runner';
import { ResolveError, Uproject } from './uproject';

export const MAX_PER_RUN = 50;

export interface ExportFs extends TreeFs, CacheIo {
  stat(p: string): { mtimeMs: number; size: number } | undefined;   // undefined when missing
  isDirectory(p: string): boolean;
  mkdir(p: string): void;
  writeFile(p: string, text: string): void;
  remove(p: string): void;
}

export interface ExportDeps {
  fs: ExportFs;
  lock: LockIo;
  run: typeof runEngine;
  now(): Date;
  scriptPath: string;   // engine/export_asset.py inside the extension
}

export interface ExportOptions {
  project: Uproject;
  engine: Engine;
  targets: string[];   // absolute .uasset files or folders
  force: boolean;
  extraArgs: string[];
  timeoutSec?: number;
}

export interface AssetOutcome {
  package: string;
  status: 'hit' | 'exported' | 'failed' | 'not exported';
  doc?: ExportDoc;
  error?: string;
}

export interface ExportResult {
  outcomes: AssetOutcome[];
  code: number;
  ran: boolean;           // false when every asset came from the cache
  timedOut: boolean;
  seconds: number;
  message?: string;       // why the whole export stopped (exit 2 and 124)
  logPath?: string;
  logWarning?: string;
}

// The caller gets its engine version from Build.version: "5.8.4".
function engineVersion(engine: Engine, fs: CacheIo): string {
  const file = win.join(engine.root, 'Engine', 'Build', 'Build.version');
  try {
    const j = JSON.parse(fs.readFile(file) ?? '');
    return `${j.MajorVersion}.${j.MinorVersion}.${j.PatchVersion}`;
  } catch {
    throw new ResolveError(`could not read the engine version from ${file}`);
  }
}

// What the log says when no manifest appeared, i.e. the script never got as far as its first line.
export function classifyEngineFailure(log: string | undefined, code: number | null): string {
  if (log !== undefined && /commandlet[^\n]*(not found|unknown|could not be found)|(failed|unable|could not) to find[^\n]*commandlet/i.test(log)) {
    return 'the engine has no PythonScript commandlet: enable the Python plugin by adding { "Name": "PythonScriptPlugin", "Enabled": true } to the "Plugins" list of the .uproject';
  }
  if (log !== undefined && /Running Python script/.test(log)) {
    return 'the export script started but failed before writing its manifest';
  }
  return `the engine exited (code ${code ?? 'killed'}) before running the export script. If the project's editor modules are not built, run \`null-unreal build\` first`;
}

// The cache entry for one file if it is still valid, without starting the engine.
// ponytail: re-reads Build.version and the plugin folders on every call; memoize if peeks get hot.
export function peekAsset(o: { project: Uproject; engine: Engine; file: string }, fs: ExportFs): ExportDoc | undefined {
  const st = fs.stat(o.file);
  if (!st) return undefined;
  try {
    const pkg = toPackagePath(o.file, findMounts(o.project.dir, fs));
    const cur = { engineVersion: engineVersion(o.engine, fs), sourceMtime: Math.floor(st.mtimeMs), sourceSize: st.size };
    const l = lookup(assetsDir(o.project.dir), pkg, cur, fs);
    return l.state === 'hit' ? l.doc : undefined;
  } catch {
    return undefined;   // an unmounted file or an unreadable engine is simply not cached
  }
}

interface Item { file: string; pkg: string; cur: { engineVersion: string; sourceMtime: number; sourceSize: number } }

export async function exportAssets(o: ExportOptions, d: ExportDeps): Promise<ExportResult> {
  const version = engineVersion(o.engine, d.fs);
  const mounts = findMounts(o.project.dir, d.fs);

  const files = new Set<string>();
  for (const t of o.targets) {
    if (d.fs.isDirectory(t)) for (const f of uassetsIn(t, d.fs)) files.add(f);
    else if (d.fs.stat(t)) files.add(t);
    else throw new ResolveError(`no such file or folder: ${t}`);
  }
  const byPkg = new Map<string, Item>();
  for (const file of files) {
    const st = d.fs.stat(file)!;
    const pkg = toPackagePath(file, mounts);
    byPkg.set(pkg, { file, pkg, cur: { engineVersion: version, sourceMtime: Math.floor(st.mtimeMs), sourceSize: st.size } });
  }
  if (byPkg.size === 0) throw new ResolveError('nothing to export: no .uasset files found');

  const assets = assetsDir(o.project.dir);
  const outcomes = new Map<string, AssetOutcome>();
  const fromCache = (it: Item) => {
    const l = lookup(assets, it.pkg, it.cur, d.fs);
    if (l.state !== 'hit') return false;
    outcomes.set(it.pkg, { package: it.pkg, status: 'hit', doc: l.doc });
    return true;
  };
  const result: ExportResult = { outcomes: [], code: 0, ran: false, timedOut: false, seconds: 0 };

  let pending = [...byPkg.values()].filter((it) => o.force || !fromCache(it));
  if (pending.length > 0) {
    const dir = win.join(o.project.dir, 'Saved', 'NullUnreal');
    const lockFile = win.join(dir, 'export.lock');
    const requestFile = win.join(dir, `export-request-${d.lock.pid}.json`);
    const manifestFile = win.join(dir, `export-manifest-${d.lock.pid}.json`);
    d.fs.mkdir(dir);

    await withLock(lockFile, d.lock, async () => {
      // Another process may have exported these while we waited for the lock.
      if (!o.force) pending = pending.filter((it) => !fromCache(it));
      if (pending.length === 0) return;

      const log = openLog(o.project.dir, 'export', d.now());
      if (log.path !== undefined) rotate(o.project.dir, 'export');
      else result.logWarning = log.warning;
      result.logPath = log.path;
      result.ran = true;

      let noManifest: { code: number | null } | undefined;
      try {
        for (let i = 0; i < pending.length; i += MAX_PER_RUN) {
          const chunk = pending.slice(i, i + MAX_PER_RUN);
          const req: Request = {
            schema: SCHEMA,
            engineVersion: version,
            outputDir: assets,
            manifest: manifestFile,
            assets: chunk.map((it) => ({ package: it.pkg, ...it.cur })),
          };
          d.fs.remove(manifestFile);
          d.fs.writeFile(requestFile, JSON.stringify(req));
          const plan = buildPlan('export', o.engine, o.project, { extraArgs: o.extraArgs, script: d.scriptPath, request: requestFile });
          plan.timeoutSec = o.timeoutSec ?? 120 + 2 * chunk.length;
          const r = await d.run(plan, log.path !== undefined ? log.stream : undefined, false);
          result.seconds += r.seconds;
          if (r.timedOut) {
            result.timedOut = true;
            result.code = 124;
            result.message = `the engine did not finish within ${plan.timeoutSec}s and was killed; assets exported before that stay cached`;
          }
          const text = d.fs.readFile(manifestFile);
          const manifest = text === undefined ? undefined : parseManifest(text);
          if (!manifest && !r.timedOut) noManifest = { code: r.code };
          for (const it of chunk) {
            const s = manifest?.[it.pkg];
            if (s?.status === 'exported') {
              const l = lookup(assets, it.pkg, it.cur, d.fs);
              outcomes.set(it.pkg, l.state === 'hit'
                ? { package: it.pkg, status: 'exported', doc: l.doc }
                : { package: it.pkg, status: 'failed', error: 'the engine reported success but wrote no valid cache entry' });
            } else if (s?.status === 'failed') {
              outcomes.set(it.pkg, { package: it.pkg, status: 'failed', error: s.error });
            } else {
              outcomes.set(it.pkg, { package: it.pkg, status: 'not exported' });
            }
          }
          // ponytail: a crash, hang or missing manifest ends the export here; the next request exports what is left.
          if (noManifest || result.timedOut || chunk.some((it) => outcomes.get(it.pkg)?.status === 'not exported')) break;
        }
      } finally {
        if (log.path !== undefined) await new Promise<void>((done) => log.stream.end(done));
        d.fs.remove(requestFile);
        d.fs.remove(manifestFile);
      }
      if (noManifest) {
        result.code = 2;
        result.message = classifyEngineFailure(result.logPath ? d.fs.readFile(result.logPath) : undefined, noManifest.code);
      }
    });
  }

  for (const it of byPkg.values()) {
    result.outcomes.push(outcomes.get(it.pkg) ?? { package: it.pkg, status: 'not exported' });
  }
  if (result.code === 0 && result.outcomes.some((x) => x.status === 'failed' || x.status === 'not exported')) result.code = 1;
  return result;
}
