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
const shim_1 = require("./shim");
const result_1 = require("./result");
function registerCommands(context, o) {
    const ctx = { cliPath: o.cliPath, output: o.output };
    for (const cmd of ['run', 'build', 'test', 'smoke']) {
        context.subscriptions.push(vscode.commands.registerCommand(`null-unreal.${cmd}`, () => runCli(cmd, ctx)));
    }
    context.subscriptions.push(vscode.commands.registerCommand('null-unreal.showCliPath', () => showCliPath(o.shimPath)));
}
// The extension never builds an engine command line: it passes settings to the CLI as flags.
function cliArgs(cmd, cliPath, before = []) {
    const cfg = vscode.workspace.getConfiguration('null-unreal');
    const args = [cliPath, cmd, ...before];
    const project = cfg.get('project', '');
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
async function execute(cmd, ctx) {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) {
        void vscode.window.showWarningMessage('Null Unreal: open the folder that holds the .uproject first.');
        return;
    }
    ctx.output.appendLine(`> null-unreal ${cmd}`);
    const { code, text } = await spawnCli(cliArgs(cmd, ctx.cliPath), folder, ctx.output);
    if (code === 0)
        return;
    const logPath = (0, result_1.parseLogPath)(text);
    const actions = logPath ? ['Open Log'] : [];
    const pick = await vscode.window.showErrorMessage(`Null Unreal: ${cmd} failed (exit ${code ?? 'killed'}).`, ...actions);
    ctx.output.show(true);
    if (pick === 'Open Log' && logPath) {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(logPath)));
    }
}
// `run` launches the editor and is not awaited by the UI: only a non-zero exit is reported.
async function runCli(cmd, ctx) {
    const go = () => execute(cmd, ctx);
    if (cmd === 'run')
        return go();
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Null Unreal: ${cmd}` }, go);
}
async function showCliPath(shimPath) {
    const snippet = (0, shim_1.cliUsageSnippet)(shimPath);
    const pick = await vscode.window.showInformationMessage(snippet, 'Copy');
    if (pick === 'Copy')
        await vscode.env.clipboard.writeText(snippet);
}
//# sourceMappingURL=commands.js.map