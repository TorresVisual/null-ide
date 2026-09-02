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
exports.registerCmakeToolbar = registerCmakeToolbar;
const vscode = __importStar(require("vscode"));
const toolchainRegistry = __importStar(require("./toolchainRegistry"));
const presetsModel_1 = require("./presetsModel");
const cmakeModel_1 = require("./cmakeModel");
const buildDiagnostics_1 = require("./buildDiagnostics");
const clangdCompileDb_1 = require("./clangdCompileDb");
const cppConfigState = __importStar(require("./cppConfigState"));
const projectDetection_1 = require("./projectDetection");
const uiState = { presets: [], targets: [] };
async function readJsonIfExists(uri) {
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        return JSON.parse(Buffer.from(bytes).toString('utf8'));
    }
    catch {
        return undefined;
    }
}
function workspaceRoot() {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
}
async function setContext(key, value) {
    await vscode.commands.executeCommand('setContext', `null-cpp.cmake.${key}`, value);
}
async function reloadPresets() {
    const root = workspaceRoot();
    if (!root) {
        uiState.presets = [];
        await setContext('hasPresets', false);
        return;
    }
    const [mainJson, userJson] = await Promise.all([
        readJsonIfExists(vscode.Uri.joinPath(root, 'CMakePresets.json')),
        readJsonIfExists(vscode.Uri.joinPath(root, 'CMakeUserPresets.json')),
    ]);
    uiState.presets = (0, presetsModel_1.loadPresets)(mainJson, userJson, root.fsPath, toolchainRegistry.list());
    await setContext('hasPresets', uiState.presets.length > 0);
}
function activePreset(context) {
    const name = cppConfigState.getConfigState(context).activePresetName;
    return uiState.presets.find((p) => p.name === name);
}
function activeTarget(context) {
    const name = cppConfigState.getConfigState(context).activeTargetName;
    return uiState.targets.find((t) => t.name === name);
}
// ---- Status bar ----
let presetItem;
let targetItem;
let configureItem;
let refreshItem;
let buildItem;
let runItem;
let buildDiagnostics;
let building = false;
function updateStatusBar(context) {
    const enabled = (0, projectDetection_1.isEnabled)();
    const preset = activePreset(context);
    const target = activeTarget(context);
    presetItem.text = `$(gear) ${preset?.displayName ?? 'Select Preset'}`;
    targetItem.text = `$(target) ${target?.name ?? 'Select Target'}`;
    configureItem.text = '$(tools) Configure';
    refreshItem.text = '$(refresh) Refresh Toolchains';
    if (!building) {
        buildItem.text = '$(play) Build';
    }
    runItem.text = target?.type === 'EXECUTABLE' ? '$(run) Run' : '$(run) Run (no executable target selected)';
    for (const item of [presetItem, targetItem, configureItem, refreshItem, buildItem, runItem]) {
        if (enabled) {
            item.show();
        }
        else {
            item.hide();
        }
    }
}
function applyBuildDiagnostics(diagnostics) {
    buildDiagnostics.clear();
    const byFile = new Map();
    for (const d of diagnostics) {
        const line = Math.max(0, d.line - 1);
        const column = Math.max(0, d.column - 1);
        const range = new vscode.Range(line, column, line, column + 1);
        const severity = d.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
        const list = byFile.get(d.absolutePath) ?? [];
        list.push(new vscode.Diagnostic(range, d.message, severity));
        byFile.set(d.absolutePath, list);
    }
    for (const [file, diags] of byFile) {
        buildDiagnostics.set(vscode.Uri.file(file), diags);
    }
}
// ---- Commands ----
async function cmdRefreshToolchains(context) {
    refreshItem.text = '$(sync~spin) Refreshing...';
    try {
        await toolchainRegistry.refresh();
        await reloadPresets();
    }
    finally {
        updateStatusBar(context);
    }
}
async function cmdSelectPreset(context) {
    if (uiState.presets.length === 0) {
        void vscode.window.showInformationMessage('No CMake presets found. Add a CMakePresets.json to this workspace first.');
        return;
    }
    const picked = await vscode.window.showQuickPick(uiState.presets.map((p) => ({
        label: p.displayName,
        description: `${p.name}${p.isWsl ? ' (WSL)' : ''} — ${p.generator}`,
        preset: p,
    })), { placeHolder: 'Select a CMake configure preset' });
    if (!picked) {
        return;
    }
    uiState.targets = [];
    await cppConfigState.setActivePreset(context, picked.preset.name);
    await setContext('presetSelected', true);
    await setContext('configured', false);
    updateStatusBar(context);
}
async function cmdConfigure(context) {
    const root = workspaceRoot();
    const preset = activePreset(context);
    if (!root || !preset) {
        void vscode.window.showErrorMessage('Select a CMake preset before configuring.');
        return;
    }
    const toolchain = toolchainRegistry.list().find((t) => t.id === preset.toolchainId);
    if (preset.isWsl && !toolchain?.wslDistro) {
        void vscode.window.showErrorMessage(`No WSL toolchain detected for preset "${preset.displayName}". Ensure cmake and a compiler are installed ` +
            'in the target WSL distro, then run "Null C++: Refresh Toolchains" and try again.');
        return;
    }
    configureItem.text = '$(sync~spin) Configuring...';
    try {
        const exitCode = await (0, cmakeModel_1.configure)(preset, root.fsPath, toolchain);
        if (exitCode !== 0) {
            void vscode.window.showErrorMessage(`CMake configure failed for preset "${preset.displayName}" (exit code ${exitCode}).`);
            await setContext('configured', false);
            return;
        }
        uiState.targets = await (0, cmakeModel_1.readCodemodelTargets)(preset.binaryDir);
        await (0, clangdCompileDb_1.writeClangdConfig)(root, preset.binaryDir);
        await cppConfigState.setLastConfiguredAt(context, Date.now());
        await setContext('configured', true);
        void vscode.window.showInformationMessage(`Configured "${preset.displayName}" — ${uiState.targets.length} target(s) found.`);
    }
    finally {
        updateStatusBar(context);
    }
}
async function cmdSelectTarget(context) {
    if (uiState.targets.length === 0) {
        void vscode.window.showInformationMessage('No targets available yet — run Configure first.');
        return;
    }
    const picked = await vscode.window.showQuickPick(uiState.targets.map((t) => ({ label: t.name, description: t.type, target: t })), { placeHolder: 'Select the active CMake target' });
    if (!picked) {
        return;
    }
    await cppConfigState.setActiveTarget(context, picked.target.name);
    updateStatusBar(context);
}
/** Runs `cmake --build`. Returns whether it succeeded. A second click while running cancels instead. */
async function cmdBuild(context, options = {}) {
    if (building) {
        (0, cmakeModel_1.cancelActive)();
        return false;
    }
    const root = workspaceRoot();
    const preset = activePreset(context);
    if (!root || !preset) {
        void vscode.window.showErrorMessage('Configure a CMake preset before building.');
        return false;
    }
    const toolchain = toolchainRegistry.list().find((t) => t.id === preset.toolchainId);
    const target = activeTarget(context);
    building = true;
    buildItem.text = '$(sync~spin) Building... (click to cancel)';
    try {
        const { exitCode, output } = await (0, cmakeModel_1.build)(preset, root.fsPath, toolchain, target, options);
        applyBuildDiagnostics((0, buildDiagnostics_1.resolveBuildDiagnostics)(output, root.fsPath, preset.isWsl, toolchain?.wslDistro));
        if (exitCode !== 0) {
            void vscode.window.showErrorMessage(`Build failed for "${preset.displayName}" (exit code ${exitCode}).`);
            return false;
        }
        return true;
    }
    finally {
        building = false;
        updateStatusBar(context);
    }
}
async function cmdClean(context) {
    const root = workspaceRoot();
    const preset = activePreset(context);
    if (!root || !preset) {
        void vscode.window.showErrorMessage('Configure a CMake preset before cleaning.');
        return;
    }
    const toolchain = toolchainRegistry.list().find((t) => t.id === preset.toolchainId);
    await (0, cmakeModel_1.cleanTarget)(preset, root.fsPath, toolchain);
}
async function cmdRun(context) {
    const preset = activePreset(context);
    const target = activeTarget(context);
    if (!preset || !target) {
        void vscode.window.showErrorMessage('Select a CMake target before running.');
        return;
    }
    if (target.type !== 'EXECUTABLE') {
        void vscode.window.showInformationMessage(`"${target.name}" is not an executable target.`);
        return;
    }
    const toolchain = toolchainRegistry.list().find((t) => t.id === preset.toolchainId);
    await (0, cmakeModel_1.run)(target, preset.isWsl, toolchain?.wslDistro);
}
async function cmdBuildAndRun(context) {
    if (await cmdBuild(context)) {
        await cmdRun(context);
    }
}
function registerCmakeToolbar(context) {
    presetItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    targetItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    configureItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    refreshItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
    buildItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96);
    runItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
    presetItem.command = 'null-cpp.cmake.selectPreset';
    targetItem.command = 'null-cpp.cmake.selectTarget';
    configureItem.command = 'null-cpp.cmake.configure';
    refreshItem.command = 'null-cpp.cmake.refreshToolchains';
    buildItem.command = 'null-cpp.cmake.build';
    runItem.command = 'null-cpp.cmake.run';
    context.subscriptions.push(presetItem, targetItem, configureItem, refreshItem, buildItem, runItem);
    buildDiagnostics = vscode.languages.createDiagnosticCollection('null-cpp-build');
    context.subscriptions.push(buildDiagnostics);
    context.subscriptions.push(vscode.commands.registerCommand('null-cpp.cmake.refreshToolchains', () => cmdRefreshToolchains(context)), vscode.commands.registerCommand('null-cpp.cmake.selectPreset', () => cmdSelectPreset(context)), vscode.commands.registerCommand('null-cpp.cmake.configure', () => cmdConfigure(context)), vscode.commands.registerCommand('null-cpp.cmake.selectTarget', () => cmdSelectTarget(context)), vscode.commands.registerCommand('null-cpp.cmake.build', () => cmdBuild(context)), vscode.commands.registerCommand('null-cpp.cmake.rebuild', () => cmdBuild(context, { clean: true })), vscode.commands.registerCommand('null-cpp.cmake.clean', () => cmdClean(context)), vscode.commands.registerCommand('null-cpp.cmake.run', () => cmdRun(context)), vscode.commands.registerCommand('null-cpp.cmake.buildAndRun', () => cmdBuildAndRun(context)));
    void (async () => {
        uiState.presets = [];
        if ((0, projectDetection_1.isEnabled)()) {
            await toolchainRegistry.refresh();
        }
        await reloadPresets();
        const preset = activePreset(context);
        await setContext('presetSelected', !!preset);
        if (preset) {
            uiState.targets = await (0, cmakeModel_1.readCodemodelTargets)(preset.binaryDir);
            await setContext('configured', uiState.targets.length > 0);
        }
        updateStatusBar(context);
    })();
}
//# sourceMappingURL=cmakeToolbar.js.map