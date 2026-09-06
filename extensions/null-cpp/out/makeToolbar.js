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
exports.refreshMakeContext = refreshMakeContext;
exports.registerMakeToolbar = registerMakeToolbar;
const vscode = __importStar(require("vscode"));
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const toolchainRegistry_1 = require("./toolchainRegistry");
const cmakeModel_1 = require("./cmakeModel");
const makefileParser_1 = require("./makefileParser");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
let hasMakefile = false;
let targets = [];
let targetItems = [];
let makeEnv;
function workspaceRoot() {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
}
async function readMakefile() {
    const root = workspaceRoot();
    if (!root) {
        return undefined;
    }
    try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, 'Makefile'));
        return Buffer.from(bytes).toString('utf8');
    }
    catch {
        return undefined;
    }
}
async function wslWhich(distro, tool) {
    try {
        const { stdout } = await execFileAsync('wsl.exe', ['-d', distro, '--', 'which', tool], { encoding: 'utf8' });
        return stdout.replace(/ /g, '').trim().length > 0;
    }
    catch {
        return false;
    }
}
/** Finds a WSL distro with `make` on its PATH — Makefile builds need a real Unix make/toolchain, not Windows. */
async function detectWslMakeEnv() {
    let stdout;
    try {
        ({ stdout } = await execFileAsync('wsl.exe', ['--list', '--quiet'], { encoding: 'utf16le' }));
    }
    catch {
        return undefined;
    }
    for (const distro of (0, toolchainRegistry_1.parseWslDistroList)(stdout)) {
        if (!(await wslWhich(distro, 'make'))) {
            continue;
        }
        const hasGxx = await wslWhich(distro, 'g++');
        if (hasGxx) {
            return { distro };
        }
        const hasClangxx = await wslWhich(distro, 'clang++');
        return { distro, cxx: hasClangxx ? 'clang++' : undefined };
    }
    return undefined;
}
function iconFor(name) {
    switch (name) {
        case 'run':
            return 'run';
        case 'clean':
            return 'trash';
        case 'test':
            return 'beaker';
        case 'debug':
            return 'debug';
        case 'help':
            return 'question';
        default:
            return 'play';
    }
}
function rebuildStatusBarItems() {
    for (const item of targetItems) {
        item.dispose();
    }
    targetItems = targets.map((target, index) => {
        const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96 - index);
        item.text = `$(${iconFor(target.name)}) Make ${target.name}`;
        item.tooltip = target.description;
        item.command = { command: 'null-cpp.make.runTarget', title: '', arguments: [target.name] };
        item.show();
        return item;
    });
}
async function refreshMakeContext() {
    const content = await readMakefile();
    hasMakefile = content !== undefined;
    targets = content ? (0, makefileParser_1.parseMakeTargets)(content) : [];
    makeEnv = hasMakefile ? await detectWslMakeEnv() : undefined;
    await vscode.commands.executeCommand('setContext', 'null-cpp.make.hasMakefile', hasMakefile);
    rebuildStatusBarItems();
}
async function runMake(target) {
    const root = workspaceRoot();
    if (!root) {
        return;
    }
    if (!makeEnv) {
        void vscode.window.showErrorMessage('No WSL distro with `make` on PATH was found. Install make (and a compiler) in WSL, then reload the window.');
        return;
    }
    const cxxArgs = makeEnv.cxx ? [`CXX=${makeEnv.cxx}`] : [];
    const targetArgs = target ? [target] : [];
    await (0, cmakeModel_1.runCommand)('make', [...cxxArgs, ...targetArgs], { cwd: root.fsPath, isWsl: true, wslDistro: makeEnv.distro });
}
async function runTargetCommand(target) {
    if (target) {
        await runMake(target);
        return;
    }
    if (targets.length === 0) {
        await runMake();
        return;
    }
    const pick = await vscode.window.showQuickPick(targets.map((t) => ({ label: t.name, description: t.description, target: t.name })), { placeHolder: 'Select a make target to run' });
    if (pick) {
        await runMake(pick.target);
    }
}
function registerMakeToolbar(context) {
    context.subscriptions.push(vscode.commands.registerCommand('null-cpp.make.runTarget', (target) => runTargetCommand(target)), vscode.workspace.onDidChangeWorkspaceFolders(() => void refreshMakeContext()), { dispose: () => targetItems.forEach((item) => item.dispose()) });
    void refreshMakeContext();
}
//# sourceMappingURL=makeToolbar.js.map