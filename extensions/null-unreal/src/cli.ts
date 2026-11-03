import * as fs from 'node:fs';
import { buildPlan, Command } from './commandLine';
import { EngineReaders, realReaders, resolveEngine } from './engine';
import { openLog, rotate } from './logs';
import { run as runEngine, RunResult } from './runner';
import { exitCodeOf, formatResult } from './result';
import { ProjectFs, ResolveError, resolveProject } from './uproject';

export interface Deps {
  cwd: string;
  project: ProjectFs;
  engine: EngineReaders;
  run: typeof runEngine;
  now(): Date;
  out(line: string): void;
}

const COMMANDS: Command[] = ['build', 'test', 'run', 'smoke'];
const VALUE_FLAGS = ['--project', '--engine', '--filter', '--timeout'];
const USAGE = 'usage: null-unreal <build|test|run|smoke> [--project <p>] [--engine <path>] [--filter <prefix>] [--timeout <s>] [-- <extra engine args>]';

export const realProjectFs: ProjectFs = {
  readdir: (dir) => fs.readdirSync(dir),
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  exists: (p) => fs.existsSync(p),
};

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
  let extraArgs: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--') {
      extraArgs = rest.slice(i + 1);
      break;
    }
    if (!VALUE_FLAGS.includes(rest[i]) || i + 1 >= rest.length) {
      deps.out(`null-unreal: bad argument ${rest[i]}`);
      deps.out(USAGE);
      return 2;
    }
    flags[rest[i]] = rest[++i];
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
      deps.out(e.message);
      return 2;
    }
    throw e;
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
  for (const line of formatResult(command, r, log.path, warning).split('\n')) deps.out(line);
  return exitCodeOf(r);
}

if (require.main === module) {
  main(process.argv.slice(2), {
    cwd: process.cwd(),
    project: realProjectFs,
    engine: realReaders,
    run: runEngine,
    now: () => new Date(),
    out: (line) => console.log(line),
  }).then((code) => {
    process.exitCode = code;
  });
}
