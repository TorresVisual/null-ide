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
exports.realProjectFs = void 0;
exports.main = main;
const fs = __importStar(require("node:fs"));
const commandLine_1 = require("./commandLine");
const engine_1 = require("./engine");
const logs_1 = require("./logs");
const runner_1 = require("./runner");
const result_1 = require("./result");
const uproject_1 = require("./uproject");
const COMMANDS = ['build', 'test', 'run', 'smoke'];
const VALUE_FLAGS = ['--project', '--engine', '--filter', '--timeout'];
const USAGE = 'usage: null-unreal <build|test|run|smoke> [--project <p>] [--engine <path>] [--filter <prefix>] [--timeout <s>] [-- <extra engine args>]';
exports.realProjectFs = {
    readdir: (dir) => fs.readdirSync(dir),
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    exists: (p) => fs.existsSync(p),
};
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
    let extraArgs = [];
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
        uproject = (0, uproject_1.resolveProject)(deps.cwd, flags['--project'], deps.project);
        engine = (0, engine_1.resolveEngine)(uproject, flags['--engine'], deps.engine);
    }
    catch (e) {
        if (e instanceof uproject_1.ResolveError) {
            deps.out(e.message);
            return 2;
        }
        throw e;
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
    for (const line of (0, result_1.formatResult)(command, r, log.path, warning).split('\n'))
        deps.out(line);
    return (0, result_1.exitCodeOf)(r);
}
if (require.main === module) {
    main(process.argv.slice(2), {
        cwd: process.cwd(),
        project: exports.realProjectFs,
        engine: engine_1.realReaders,
        run: runner_1.run,
        now: () => new Date(),
        out: (line) => console.log(line),
    }).then((code) => {
        process.exitCode = code;
    });
}
//# sourceMappingURL=cli.js.map