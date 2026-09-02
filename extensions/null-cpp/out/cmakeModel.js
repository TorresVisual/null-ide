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
exports.cancelActive = cancelActive;
exports.runCommand = runCommand;
exports.writeCodemodelQuery = writeCodemodelQuery;
exports.configure = configure;
exports.build = build;
exports.cleanTarget = cleanTarget;
exports.run = run;
exports.readCodemodelTargets = readCodemodelTargets;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("node:path"));
const node_child_process_1 = require("node:child_process");
const cmakeReply_1 = require("./cmakeReply");
const toolchainRegistry_1 = require("./toolchainRegistry");
const wslPath_1 = require("./wslPath");
// ---- Process execution, streamed into a dedicated, reused terminal ----
const TERMINAL_NAME = 'Null C++: CMake';
let writeEmitter;
let ptyTerminal;
let activeProcess;
function ensureTerminal() {
    if (ptyTerminal) {
        return ptyTerminal;
    }
    writeEmitter = new vscode.EventEmitter();
    const closeEmitter = new vscode.EventEmitter();
    const pty = {
        onDidWrite: writeEmitter.event,
        onDidClose: closeEmitter.event,
        open: () => { },
        close: () => {
            activeProcess?.kill();
        },
        handleInput: (data) => {
            if (data === '\x03') {
                activeProcess?.kill();
            }
        },
    };
    ptyTerminal = vscode.window.createTerminal({ name: TERMINAL_NAME, pty });
    vscode.window.onDidCloseTerminal((t) => {
        if (t === ptyTerminal) {
            ptyTerminal = undefined;
            writeEmitter = undefined;
        }
    });
    return ptyTerminal;
}
function writeLine(text) {
    writeEmitter?.fire(`${text.replace(/\r?\n/g, '\r\n')}\r\n`);
}
/** Cancels whatever cmake/build/run process is currently streaming into the shared terminal. */
function cancelActive() {
    activeProcess?.kill();
}
/** Spawns `command` (optionally WSL-wrapped), streaming output into the shared terminal. */
async function runCommand(command, args, options) {
    const terminal = ensureTerminal();
    if (options.show !== false) {
        terminal.show(true);
    }
    activeProcess?.kill();
    activeProcess = undefined;
    const resolved = options.isWsl && options.wslDistro ? (0, cmakeReply_1.wrapWslCommand)(command, args, options.wslDistro) : { command, args };
    writeLine(`> ${resolved.command} ${resolved.args.join(' ')}`);
    return new Promise((resolve) => {
        const child = (0, node_child_process_1.spawn)(resolved.command, resolved.args, { cwd: options.cwd, shell: false, env: options.env });
        activeProcess = child;
        let output = '';
        const onData = (chunk) => {
            const text = chunk.toString();
            output += text;
            writeEmitter?.fire(text.replace(/\r?\n/g, '\r\n'));
        };
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.on('error', (err) => {
            writeLine(`Failed to start "${resolved.command}": ${err.message}`);
            activeProcess = undefined;
            resolve({ exitCode: -1, output });
        });
        child.on('close', (code) => {
            writeLine(`[exit code ${code ?? -1}]`);
            activeProcess = undefined;
            resolve({ exitCode: code ?? -1, output });
        });
    });
}
// ---- CMake File API ----
/** Writes the "shared, stateless" query stub that asks CMake to emit a codemodel-v2 reply on the next configure. */
async function writeCodemodelQuery(binaryDir) {
    const queryDir = vscode.Uri.file(path.join(binaryDir, '.cmake', 'api', 'v1', 'query'));
    await vscode.workspace.fs.createDirectory(queryDir);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(queryDir, 'codemodel-v2'), new Uint8Array());
}
async function configure(preset, sourceDir, toolchain) {
    await writeCodemodelQuery(preset.binaryDir);
    const msvcEnv = toolchain ? await (0, toolchainRegistry_1.getMsvcDevEnvironment)(toolchain) : undefined;
    const { exitCode } = await runCommand('cmake', ['--preset', preset.name], {
        cwd: sourceDir,
        isWsl: preset.isWsl,
        wslDistro: toolchain?.wslDistro,
        env: msvcEnv ? { ...process.env, ...msvcEnv } : undefined,
    });
    return exitCode;
}
/** Runs `cmake --build --preset <p>` (optionally scoped to `target`), streamed into the shared terminal. */
async function build(preset, sourceDir, toolchain, target, options = {}) {
    const msvcEnv = toolchain ? await (0, toolchainRegistry_1.getMsvcDevEnvironment)(toolchain) : undefined;
    const args = ['--build', '--preset', preset.name];
    if (target) {
        args.push('--target', target.name);
    }
    if (options.clean) {
        args.push('--clean-first');
    }
    return runCommand('cmake', args, {
        cwd: sourceDir,
        isWsl: preset.isWsl,
        wslDistro: toolchain?.wslDistro,
        env: msvcEnv ? { ...process.env, ...msvcEnv } : undefined,
    });
}
async function cleanTarget(preset, sourceDir, toolchain) {
    const msvcEnv = toolchain ? await (0, toolchainRegistry_1.getMsvcDevEnvironment)(toolchain) : undefined;
    const { exitCode } = await runCommand('cmake', ['--build', '--preset', preset.name, '--target', 'clean'], {
        cwd: sourceDir,
        isWsl: preset.isWsl,
        wslDistro: toolchain?.wslDistro,
        env: msvcEnv ? { ...process.env, ...msvcEnv } : undefined,
    });
    return exitCode;
}
/** Launches `target`'s artifact in the shared terminal — via `wsl.exe` for WSL presets. */
async function run(target, isWsl, wslDistro) {
    const command = isWsl ? (0, wslPath_1.toWslPath)(target.artifactPath) : target.artifactPath;
    const { exitCode } = await runCommand(command, [], {
        cwd: path.dirname(target.artifactPath),
        isWsl,
        wslDistro,
    });
    return exitCode;
}
async function readJson(uri) {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
}
/** Reads the targets produced by the most recent configure, via the CMake File API reply written alongside it. */
async function readCodemodelTargets(binaryDir) {
    const replyDir = vscode.Uri.file(path.join(binaryDir, '.cmake', 'api', 'v1', 'reply'));
    let entries;
    try {
        entries = await vscode.workspace.fs.readDirectory(replyDir);
    }
    catch {
        return [];
    }
    const indexFile = (0, cmakeReply_1.pickLatestIndexFile)(entries.map(([name]) => name));
    if (!indexFile) {
        return [];
    }
    const ref = (0, cmakeReply_1.parseReplyIndex)(await readJson(vscode.Uri.joinPath(replyDir, indexFile)));
    if (!ref) {
        return [];
    }
    const codemodelJson = await readJson(vscode.Uri.joinPath(replyDir, ref.jsonFile));
    const targetRefs = (0, cmakeReply_1.parseCodemodelTargets)(codemodelJson);
    const targets = [];
    for (const targetRef of targetRefs) {
        const detailJson = await readJson(vscode.Uri.joinPath(replyDir, targetRef.jsonFile));
        targets.push((0, cmakeReply_1.parseTargetDetail)(targetRef.name, detailJson, binaryDir));
    }
    return targets;
}
//# sourceMappingURL=cmakeModel.js.map