"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.realLockIo = exports.realExportFs = exports.realProjectFs = void 0;
exports.main = main;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const commandLine_1 = require("./commandLine");
const engine_1 = require("./engine");
const exporter_1 = require("./exporter");
const exportFormat_1 = require("./exportFormat");
const logs_1 = require("./logs");
const runner_1 = require("./runner");
const result_1 = require("./result");
const summary_1 = require("./summary");
const uproject_1 = require("./uproject");
const COMMANDS = ['build', 'test', 'run', 'editor', 'smoke', 'compdb', 'export'];
const VALUE_FLAGS = ['--project', '--engine', '--filter', '--timeout'];
const BOOL_FLAGS = ['--json', '--force'];
const USAGE = [
    'usage: null-unreal <build|test|run|editor|smoke|compdb> [--project <p>] [--engine <path>] [--filter <prefix>] [--timeout <s>] [-- <extra engine args>]',
    '       null-unreal export <asset.uasset|folder>... [--json] [--force] [--project <p>] [--engine <path>] [--timeout <s>] [-- <extra engine args>]',
].join('\n');
exports.realProjectFs = {
    readdir: (dir) => fs.readdirSync(dir),
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    exists: (p) => fs.existsSync(p),
};
exports.realExportFs = {
    list: (dir) => {
        try {
            return fs.readdirSync(dir, { withFileTypes: true }).map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
        }
        catch {
            return [];
        }
    },
    exists: (p) => fs.existsSync(p),
    readFile: (p) => {
        try {
            return fs.readFileSync(p, 'utf8');
        }
        catch {
            return undefined;
        }
    },
    stat: (p) => {
        try {
            const st = fs.statSync(p);
            return { mtimeMs: st.mtimeMs, size: st.size };
        }
        catch {
            return undefined;
        }
    },
    isDirectory: (p) => {
        try {
            return fs.statSync(p).isDirectory();
        }
        catch {
            return false;
        }
    },
    mkdir: (p) => void fs.mkdirSync(p, { recursive: true }),
    writeFile: (p, text) => fs.writeFileSync(p, text),
    remove: (p) => fs.rmSync(p, { force: true }),
};
exports.realLockIo = {
    create(file, contents) {
        try {
            fs.writeFileSync(file, contents, { flag: 'wx' });
            return true;
        }
        catch (e) {
            if (e.code === 'EEXIST')
                return false;
            throw e;
        }
    },
    read: (file) => exports.realExportFs.readFile(file),
    remove: (file) => fs.rmSync(file, { force: true }),
    alive(pid) {
        try {
            process.kill(pid, 0);
            return true;
        }
        catch (e) {
            return e.code === 'EPERM';
        }
    },
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    now: () => Date.now(),
    pid: process.pid,
};
// One line per asset: package, kind, status, then the summary or the error.
function assetLine(o) {
    const kind = o.doc?.kind ?? '-';
    if (o.doc && (o.status === 'hit' || o.status === 'exported')) {
        return `${o.package}  ${kind}  ${o.status === 'hit' ? 'cached' : 'exported'}  ${(0, exportFormat_1.summarize)(o.doc)}`;
    }
    return `${o.package}  ${kind}  ${o.status}${o.error ? `  ${o.error}` : ''}`;
}
async function runExport(deps, uproject, engine, targets, o) {
    const say = o.json ? deps.err : deps.out; // under --json stdout carries only the JSON
    let r;
    try {
        r = await (0, exporter_1.exportAssets)({
            project: uproject,
            engine,
            targets: targets.map((t) => path.resolve(deps.cwd, t)),
            force: o.force,
            extraArgs: o.extraArgs,
            timeoutSec: o.timeout,
        }, { ...deps.exp, run: deps.run, now: deps.now });
    }
    catch (e) {
        if (e instanceof uproject_1.ResolveError) {
            say(e.message);
            return 2;
        }
        throw e;
    }
    for (const a of r.outcomes)
        say(assetLine(a));
    if (r.message)
        say(`null-unreal export: ${r.message}`);
    // One asset prints its object, several print an array.
    const docs = r.outcomes.flatMap((a) => (a.doc ? [a.doc] : []));
    if (o.json && docs.length > 0)
        deps.out(JSON.stringify(docs.length === 1 ? docs[0] : docs, null, 2));
    if (!r.ran) {
        say('null-unreal export: exit 0 (served from the cache)');
    }
    else {
        const result = { code: r.code, timedOut: r.timedOut, seconds: r.seconds };
        for (const line of (0, result_1.formatResult)('export', result, r.logPath, r.logWarning).split('\n'))
            say(line);
    }
    return r.code;
}
// Returns the exit code. Output is the two result lines (plus any usage or resolution message).
async function main(argv, deps) {
    const [cmd, ...rest] = argv;
    if (!COMMANDS.includes(cmd)) {
        deps.out(`null-unreal: unknown command "${cmd ?? ''}"`);
        deps.out(USAGE);
        return 2;
    }
    const command = cmd;
    const flags = {};
    const bools = new Set();
    const targets = [];
    let extraArgs = [];
    for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--') {
            extraArgs = rest.slice(i + 1);
            break;
        }
        if (command === 'export' && BOOL_FLAGS.includes(rest[i])) {
            bools.add(rest[i]);
        }
        else if (command === 'export' && !rest[i].startsWith('-')) {
            targets.push(rest[i]);
        }
        else if (VALUE_FLAGS.includes(rest[i]) && i + 1 < rest.length) {
            flags[rest[i]] = rest[++i];
        }
        else {
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
        uproject = (0, uproject_1.resolveProject)(deps.cwd, flags['--project'], deps.project);
        engine = (0, engine_1.resolveEngine)(uproject, flags['--engine'], deps.engine);
    }
    catch (e) {
        if (e instanceof uproject_1.ResolveError) {
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
    const plan = (0, commandLine_1.buildPlan)(command, engine, uproject, { filter: flags['--filter'], extraArgs });
    if (timeout !== undefined)
        plan.timeoutSec = timeout;
    const log = (0, logs_1.openLog)(uproject.dir, command, deps.now());
    if (log.path !== undefined)
        (0, logs_1.rotate)(uproject.dir, command);
    let r;
    if (log.path !== undefined) {
        r = await deps.run(plan, log.stream, false);
        await new Promise((done) => log.stream.end(done));
    }
    else {
        r = await deps.run(plan, undefined, false);
    }
    const warning = log.path === undefined ? log.warning : undefined;
    let code = (0, result_1.exitCodeOf)(r);
    let summary = [];
    if (command !== 'run' && command !== 'editor') {
        // The log is the one copy of the output; without it there is nothing to summarize and nothing proven.
        const text = log.path !== undefined ? deps.readLog(log.path) : undefined;
        const s = text !== undefined ? (0, summary_1.summarizeLog)(command, text, log.path) : undefined;
        summary = s?.lines ?? ['could not summarize (no log was kept)'];
        // A run the summary calls failed, or cannot judge, is never green: exit 0 becomes 1.
        if (code === 0 && s?.verdict !== 'ok')
            code = 1;
    }
    for (const line of (0, result_1.formatResult)(command, { ...r, code: r.timedOut ? r.code : code }, log.path, warning).split('\n'))
        deps.out(line);
    for (const line of summary)
        deps.out(line);
    return code;
}
if (require.main === module) {
    main(process.argv.slice(2), {
        cwd: process.cwd(),
        project: exports.realProjectFs,
        engine: engine_1.realReaders,
        run: runner_1.run,
        now: () => new Date(),
        out: (line) => console.log(line),
        err: (line) => console.error(line),
        exp: { fs: exports.realExportFs, lock: exports.realLockIo, scriptPath: path.join(__dirname, '..', 'engine', 'export_asset.py') },
        readLog: exports.realExportFs.readFile,
    }).then((code) => {
        process.exitCode = code;
    });
}
//# sourceMappingURL=cli.js.map