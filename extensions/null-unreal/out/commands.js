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
exports.registerCommands = registerCommands;
exports.cliArgs = cliArgs;
exports.spawnCli = spawnCli;
const node_child_process_1 = require("node:child_process");
const vscode = __importStar(require("vscode"));
const cli_1 = require("./cli");
const logs_1 = require("./logs");
const shim_1 = require("./shim");
const result_1 = require("./result");
const uproject_1 = require("./uproject");
function registerCommands(context, o) {
    const ctx = { cliPath: o.cliPath, output: o.output };
    for (const cmd of ['run', 'build', 'test', 'smoke']) {
        context.subscriptions.push(vscode.commands.registerCommand(`null-unreal.${cmd}`, () => runCli(cmd, ctx)));
    }
    context.subscriptions.push(
    // From the editor title or the explorer the .uproject is the argument; the palette falls back to the open editor.
    vscode.commands.registerCommand('null-unreal.openEditor', (uri) => {
        const file = (uri ?? vscode.window.activeTextEditor?.document.uri)?.fsPath;
        return execute('editor', ctx, file?.toLowerCase().endsWith('.uproject') ? file : undefined).then(() => undefined);
    }), vscode.commands.registerCommand('null-unreal.generateClangdDatabase', () => generateClangdDatabase(ctx)), vscode.commands.registerCommand('null-unreal.openLastLog', openLastLog), vscode.commands.registerCommand('null-unreal.showCliPath', () => showCliPath(o.shimPath)));
}
// The extension never builds an engine command line: it passes settings to the CLI as flags.
function cliArgs(cmd, cliPath, before = [], projectFile) {
    const cfg = vscode.workspace.getConfiguration('null-unreal');
    const args = [cliPath, cmd, ...before];
    const project = projectFile ?? cfg.get('project', '');
    const enginePath = cfg.get('enginePath', '');
    if (project)
        args.push('--project', project);
    if (enginePath)
        args.push('--engine', enginePath);
    args.push('--', ...cfg.get(`${cmd}.args`, []));
    return args;
}
function spawnCli(args, cwd, output) {
    return new Promise((resolve) => {
        let text = '';
        const onData = (d) => {
            const s = d.toString();
            text += s;
            output.append(s);
        };
        const child = (0, node_child_process_1.spawn)(process.execPath, args, {
            cwd,
            shell: false,
            windowsHide: true,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        });
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('error', (err) => {
            output.appendLine(err.message);
            resolve({ code: null, text: text + err.message });
        });
        child.on('close', (code) => resolve({ code, text }));
    });
}
async function execute(cmd, ctx, projectFile) {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) {
        void vscode.window.showWarningMessage('Null Unreal: open the folder that holds the .uproject first.');
        return false;
    }
    ctx.output.appendLine(`> null-unreal ${cmd}`);
    const { code, text } = await spawnCli(cliArgs(cmd, ctx.cliPath, [], projectFile), folder, ctx.output);
    if (code === 0)
        return true;
    const logPath = (0, result_1.parseLogPath)(text);
    const actions = logPath ? ['Open Log'] : [];
    const pick = await vscode.window.showErrorMessage(`Null Unreal: ${cmd} failed (exit ${code ?? 'killed'}).`, ...actions);
    ctx.output.show(true);
    if (pick === 'Open Log' && logPath) {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(logPath)));
    }
    return false;
}
// `run` launches the editor and is not awaited by the UI: only a non-zero exit is reported.
async function runCli(cmd, ctx) {
    const go = async () => void (await execute(cmd, ctx));
    if (cmd === 'run')
        return go();
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Null Unreal: ${cmd}` }, go);
}
// compile_commands.json lands beside the .uproject; clangd only needs a restart to read it.
async function generateClangdDatabase(ctx) {
    const ok = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Null Unreal: generating the clangd database' }, () => execute('compdb', ctx));
    if (!ok)
        return;
    if ((await vscode.commands.getCommands(true)).includes('clangd.restart')) {
        await vscode.commands.executeCommand('clangd.restart');
    }
    void vscode.window.showInformationMessage('Null Unreal: compile_commands.json written next to the .uproject.');
}
async function openLastLog() {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) {
        void vscode.window.showWarningMessage('Null Unreal: open the folder that holds the .uproject first.');
        return;
    }
    let file;
    try {
        const project = vscode.workspace.getConfiguration('null-unreal').get('project', '');
        file = (0, logs_1.latestLogAny)((0, uproject_1.resolveProject)(folder, project || undefined, cli_1.realProjectFs).dir);
    }
    catch (e) {
        if (!(e instanceof uproject_1.ResolveError))
            throw e;
        void vscode.window.showWarningMessage(`Null Unreal: ${e.message}`);
        return;
    }
    if (!file) {
        void vscode.window.showInformationMessage('Null Unreal: no log yet.');
        return;
    }
    await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true });
}
async function showCliPath(shimPath) {
    const snippet = (0, shim_1.cliUsageSnippet)(shimPath);
    const pick = await vscode.window.showInformationMessage(snippet, 'Copy');
    if (pick === 'Copy')
        await vscode.env.clipboard.writeText(snippet);
}
//# sourceMappingURL=commands.js.map