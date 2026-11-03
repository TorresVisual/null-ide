import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildPlan, Command } from './commandLine';
import { EngineReaders, realReaders, resolveEngine } from './engine';
import { AssetOutcome, ExportDeps, ExportFs, exportAssets, ExportResult } from './exporter';
import { summarize } from './exportFormat';
import { LockIo } from './lock';
import { openLog, rotate } from './logs';
import { run as runEngine, RunResult } from './runner';
import { exitCodeOf, formatResult } from './result';
import { summarizeLog } from './summary';
import { ProjectFs, ResolveError, resolveProject } from './uproject';

export interface Deps {
  cwd: string;
  project: ProjectFs;
  engine: EngineReaders;
  run: typeof runEngine;
  now(): Date;
  out(line: string): void;
  err(line: string): void;   // diagnostics that must stay off stdout (`export --json`)
  exp: Pick<ExportDeps, 'fs' | 'lock' | 'scriptPath'>;
  readLog(file: string): string | undefined;
}

const COMMANDS: Command[] = ['build', 'test', 'run', 'editor', 'smoke', 'compdb', 'export'];
const VALUE_FLAGS = ['--project', '--engine', '--filter', '--timeout'];
const BOOL_FLAGS = ['--json', '--force'];
const USAGE = [
  'usage: null-unreal <build|test|run|editor|smoke|compdb> [--project <p>] [--engine <path>] [--filter <prefix>] [--timeout <s>] [-- <extra engine args>]',
  '       null-unreal export <asset.uasset|folder>... [--json] [--force] [--project <p>] [--engine <path>] [--timeout <s>] [-- <extra engine args>]',
].join('\n');

export const realProjectFs: ProjectFs = {
  readdir: (dir) => fs.readdirSync(dir),
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  exists: (p) => fs.existsSync(p),
};

export const realExportFs: ExportFs = {
  list: (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
    } catch {
      return [];
    }
  },
  exists: (p) => fs.existsSync(p),
  readFile: (p) => {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return undefined;
    }
  },
  stat: (p) => {
    try {
      const st = fs.statSync(p);
      return { mtimeMs: st.mtimeMs, size: st.size };
    } catch {
      return undefined;
    }
  },
  isDirectory: (p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  mkdir: (p) => void fs.mkdirSync(p, { recursive: true }),
  writeFile: (p, text) => fs.writeFileSync(p, text),
  remove: (p) => fs.rmSync(p, { force: true }),
};

export const realLockIo: LockIo = {
  create(file, contents) {
    try {
      fs.writeFileSync(file, contents, { flag: 'wx' });
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw e;
    }
  },
  read: (file) => realExportFs.readFile(file),
  remove: (file) => fs.rmSync(file, { force: true }),
  alive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'EPERM';
    }
  },
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  now: () => Date.now(),
  pid: process.pid,
};

// One line per asset: package, kind, status, then the summary or the error.
function assetLine(o: AssetOutcome): string {
  const kind = o.doc?.kind ?? '-';
  if (o.doc && (o.status === 'hit' || o.status === 'exported')) {
    return `${o.package}  ${kind}  ${o.status === 'hit' ? 'cached' : 'exported'}  ${summarize(o.doc)}`;
  }
  return `${o.package}  ${kind}  ${o.status}${o.error ? `  ${o.error}` : ''}`;
}

async function runExport(
  deps: Deps,
  uproject: ReturnType<typeof resolveProject>,
  engine: ReturnType<typeof resolveEngine>,
  targets: string[],
  o: { json: boolean; force: boolean; timeout: number | undefined; extraArgs: string[] },
): Promise<number> {
  const say = o.json ? deps.err : deps.out;   // under --json stdout carries only the JSON
  let r: ExportResult;
  try {
    r = await exportAssets(
      {
        project: uproject,
        engine,
        targets: targets.map((t) => path.resolve(deps.cwd, t)),
        force: o.force,
        extraArgs: o.extraArgs,
        timeoutSec: o.timeout,
      },
      { ...deps.exp, run: deps.run, now: deps.now },
    );
  } catch (e) {
    if (e instanceof ResolveError) {
      say(e.message);
      return 2;
    }
    throw e;
  }

  for (const a of r.outcomes) say(assetLine(a));
  if (r.message) say(`null-unreal export: ${r.message}`);
  // One asset prints its object, several print an array.
  const docs = r.outcomes.flatMap((a) => (a.doc ? [a.doc] : []));
  if (o.json && docs.length > 0) deps.out(JSON.stringify(docs.length === 1 ? docs[0] : docs, null, 2));

  if (!r.ran) {
    say('null-unreal export: exit 0 (served from the cache)');
  } else {
    const result = { code: r.code, timedOut: r.timedOut, seconds: r.seconds };
    for (const line of formatResult('export', result, r.logPath, r.logWarning).split('\n')) say(line);
  }
  return r.code;
}

// Returns the exit code. Output is the two result lines (plus any usage or resolution message).
export async function main(argv: string[], deps: Deps): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!COMMANDS.includes(cmd as Command)) {
    deps.out(`null-unreal: unknown command "${cmd ?? ''}"`);
    deps.out(USAGE);
    return 2;
  }
  const command = cmd as Command;

  const flags: Record<string, string> = {};
  const bools = new Set<string>();
  const targets: string[] = [];
  let extraArgs: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--') {
      extraArgs = rest.slice(i + 1);
      break;
    }
    if (command === 'export' && BOOL_FLAGS.includes(rest[i])) {
      bools.add(rest[i]);
    } else if (command === 'export' && !rest[i].startsWith('-')) {
      targets.push(rest[i]);
    } else if (VALUE_FLAGS.includes(rest[i]) && i + 1 < rest.length) {
      flags[rest[i]] = rest[++i];
    } else {
      deps.out(`null-unreal: bad argument ${rest[i]}`);
      deps.out(USAGE);
      return 2;
    }
  }
  if (command === 'export' && targets.length === 0) {
    deps.out('null-unreal: export needs at least one .uasset file or folder');
    deps.out(USAGE);
    return 2;
  }
  const timeout = flags['--timeout'] !== undefined ? Number(flags['--timeout']) : undefined;
  if (timeout !== undefined && !(timeout > 0)) {
    deps.out(`null-unreal: --timeout must be a positive number of seconds`);
    return 2;
  }

  let uproject;
  let engine;
  try {
    uproject = resolveProject(deps.cwd, flags['--project'], deps.project);
    engine = resolveEngine(uproject, flags['--engine'], deps.engine);
  } catch (e) {
    if (e instanceof ResolveError) {
      (bools.has('--json') ? deps.err : deps.out)(e.message);
      return 2;
    }
    throw e;
  }

  if (command === 'export') {
    return runExport(deps, uproject, engine, targets, {
      json: bools.has('--json'),
      force: bools.has('--force'),
      timeout,
      extraArgs,
    });
  }

  const plan = buildPlan(command, engine, uproject, { filter: flags['--filter'], extraArgs });
  if (timeout !== undefined) plan.timeoutSec = timeout;

  const log = openLog(uproject.dir, command, deps.now());
  if (log.path !== undefined) rotate(uproject.dir, command);

  let r: RunResult;
  if (log.path !== undefined) {
    r = await deps.run(plan, log.stream, false);
    await new Promise<void>((done) => log.stream.end(done));
  } else {
    r = await deps.run(plan, undefined, false);
  }

  const warning = log.path === undefined ? log.warning : undefined;
  let code = exitCodeOf(r);
  let summary: string[] = [];
  if (command !== 'run' && command !== 'editor') {
    // The log is the one copy of the output; without it there is nothing to summarize and nothing proven.
    const text = log.path !== undefined ? deps.readLog(log.path) : undefined;
    const s = text !== undefined ? summarizeLog(command, text, log.path) : undefined;
    summary = s?.lines ?? ['could not summarize (no log was kept)'];
    // A run the summary calls failed, or cannot judge, is never green: exit 0 becomes 1.
    if (code === 0 && s?.verdict !== 'ok') code = 1;
  }
  for (const line of formatResult(command, { ...r, code: r.timedOut ? r.code : code }, log.path, warning).split('\n')) deps.out(line);
  for (const line of summary) deps.out(line);
  return code;
}

if (require.main === module) {
  main(process.argv.slice(2), {
    cwd: process.cwd(),
    project: realProjectFs,
    engine: realReaders,
    run: runEngine,
    now: () => new Date(),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    exp: { fs: realExportFs, lock: realLockIo, scriptPath: path.join(__dirname, '..', 'engine', 'export_asset.py') },
    readLog: realExportFs.readFile,
  }).then((code) => {
    process.exitCode = code;
  });
}
