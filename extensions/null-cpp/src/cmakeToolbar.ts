import * as vscode from 'vscode';
import * as toolchainRegistry from './toolchainRegistry';
import { loadPresets, type CMakePreset } from './presetsModel';
import { configure, readCodemodelTargets, build, cleanTarget, run as runTarget, cancelActive, type CMakeTarget } from './cmakeModel';
import { resolveBuildDiagnostics, type ResolvedBuildDiagnostic } from './buildDiagnostics';
import { writeClangdConfig } from './clangdCompileDb';
import * as cppConfigState from './cppConfigState';
import { isEnabled } from './projectDetection';

interface UiState {
  presets: CMakePreset[];
  targets: CMakeTarget[];
}

const uiState: UiState = { presets: [], targets: [] };

async function readJsonIfExists(uri: vscode.Uri): Promise<unknown> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return undefined;
  }
}

function workspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function setContext(key: string, value: boolean): Promise<void> {
  await vscode.commands.executeCommand('setContext', `null-cpp.cmake.${key}`, value);
}

async function reloadPresets(): Promise<void> {
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
  uiState.presets = loadPresets(mainJson, userJson, root.fsPath, toolchainRegistry.list());
  await setContext('hasPresets', uiState.presets.length > 0);
}

function activePreset(context: vscode.ExtensionContext): CMakePreset | undefined {
  const name = cppConfigState.getConfigState(context).activePresetName;
  return uiState.presets.find((p) => p.name === name);
}

function activeTarget(context: vscode.ExtensionContext): CMakeTarget | undefined {
  const name = cppConfigState.getConfigState(context).activeTargetName;
  return uiState.targets.find((t) => t.name === name);
}

// ---- Status bar ----

let presetItem: vscode.StatusBarItem;
let targetItem: vscode.StatusBarItem;
let configureItem: vscode.StatusBarItem;
let refreshItem: vscode.StatusBarItem;
let buildItem: vscode.StatusBarItem;
let runItem: vscode.StatusBarItem;
let buildDiagnostics: vscode.DiagnosticCollection;
let building = false;

function updateStatusBar(context: vscode.ExtensionContext): void {
  const enabled = isEnabled();
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
    } else {
      item.hide();
    }
  }
}

function applyBuildDiagnostics(diagnostics: ResolvedBuildDiagnostic[]): void {
  buildDiagnostics.clear();
  const byFile = new Map<string, vscode.Diagnostic[]>();
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

async function cmdRefreshToolchains(context: vscode.ExtensionContext): Promise<void> {
  refreshItem.text = '$(sync~spin) Refreshing...';
  try {
    await toolchainRegistry.refresh();
    await reloadPresets();
  } finally {
    updateStatusBar(context);
  }
}

async function cmdSelectPreset(context: vscode.ExtensionContext): Promise<void> {
  if (uiState.presets.length === 0) {
    void vscode.window.showInformationMessage(
      'No CMake presets found. Add a CMakePresets.json to this workspace first.'
    );
    return;
  }
  const picked = await vscode.window.showQuickPick(
    uiState.presets.map((p) => ({
      label: p.displayName,
      description: `${p.name}${p.isWsl ? ' (WSL)' : ''} — ${p.generator}`,
      preset: p,
    })),
    { placeHolder: 'Select a CMake configure preset' }
  );
  if (!picked) {
    return;
  }
  uiState.targets = [];
  await cppConfigState.setActivePreset(context, picked.preset.name);
  await setContext('presetSelected', true);
  await setContext('configured', false);
  updateStatusBar(context);
}

async function cmdConfigure(context: vscode.ExtensionContext): Promise<void> {
  const root = workspaceRoot();
  const preset = activePreset(context);
  if (!root || !preset) {
    void vscode.window.showErrorMessage('Select a CMake preset before configuring.');
    return;
  }

  const toolchain = toolchainRegistry.list().find((t) => t.id === preset.toolchainId);
  if (preset.isWsl && !toolchain?.wslDistro) {
    void vscode.window.showErrorMessage(
      `No WSL toolchain detected for preset "${preset.displayName}". Ensure cmake and a compiler are installed ` +
        'in the target WSL distro, then run "Null C++: Refresh Toolchains" and try again.'
    );
    return;
  }
  configureItem.text = '$(sync~spin) Configuring...';
  try {
    const exitCode = await configure(preset, root.fsPath, toolchain);
    if (exitCode !== 0) {
      void vscode.window.showErrorMessage(`CMake configure failed for preset "${preset.displayName}" (exit code ${exitCode}).`);
      await setContext('configured', false);
      return;
    }
    uiState.targets = await readCodemodelTargets(preset.binaryDir);
    await writeClangdConfig(root, preset.binaryDir);
    await cppConfigState.setLastConfiguredAt(context, Date.now());
    await setContext('configured', true);
    void vscode.window.showInformationMessage(`Configured "${preset.displayName}" — ${uiState.targets.length} target(s) found.`);
  } finally {
    updateStatusBar(context);
  }
}

async function cmdSelectTarget(context: vscode.ExtensionContext): Promise<void> {
  if (uiState.targets.length === 0) {
    void vscode.window.showInformationMessage('No targets available yet — run Configure first.');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    uiState.targets.map((t) => ({ label: t.name, description: t.type, target: t })),
    { placeHolder: 'Select the active CMake target' }
  );
  if (!picked) {
    return;
  }
  await cppConfigState.setActiveTarget(context, picked.target.name);
  updateStatusBar(context);
}

/** Runs `cmake --build`. Returns whether it succeeded. A second click while running cancels instead. */
async function cmdBuild(context: vscode.ExtensionContext, options: { clean?: boolean } = {}): Promise<boolean> {
  if (building) {
    cancelActive();
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
    const { exitCode, output } = await build(preset, root.fsPath, toolchain, target, options);
    applyBuildDiagnostics(resolveBuildDiagnostics(output, root.fsPath, preset.isWsl, toolchain?.wslDistro));
    if (exitCode !== 0) {
      void vscode.window.showErrorMessage(`Build failed for "${preset.displayName}" (exit code ${exitCode}).`);
      return false;
    }
    return true;
  } finally {
    building = false;
    updateStatusBar(context);
  }
}

async function cmdClean(context: vscode.ExtensionContext): Promise<void> {
  const root = workspaceRoot();
  const preset = activePreset(context);
  if (!root || !preset) {
    void vscode.window.showErrorMessage('Configure a CMake preset before cleaning.');
    return;
  }
  const toolchain = toolchainRegistry.list().find((t) => t.id === preset.toolchainId);
  await cleanTarget(preset, root.fsPath, toolchain);
}

async function cmdRun(context: vscode.ExtensionContext): Promise<void> {
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
  await runTarget(target, preset.isWsl, toolchain?.wslDistro);
}

async function cmdBuildAndRun(context: vscode.ExtensionContext): Promise<void> {
  if (await cmdBuild(context)) {
    await cmdRun(context);
  }
}

export function registerCmakeToolbar(context: vscode.ExtensionContext): void {
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

  context.subscriptions.push(
    vscode.commands.registerCommand('null-cpp.cmake.refreshToolchains', () => cmdRefreshToolchains(context)),
    vscode.commands.registerCommand('null-cpp.cmake.selectPreset', () => cmdSelectPreset(context)),
    vscode.commands.registerCommand('null-cpp.cmake.configure', () => cmdConfigure(context)),
    vscode.commands.registerCommand('null-cpp.cmake.selectTarget', () => cmdSelectTarget(context)),
    vscode.commands.registerCommand('null-cpp.cmake.build', () => cmdBuild(context)),
    vscode.commands.registerCommand('null-cpp.cmake.rebuild', () => cmdBuild(context, { clean: true })),
    vscode.commands.registerCommand('null-cpp.cmake.clean', () => cmdClean(context)),
    vscode.commands.registerCommand('null-cpp.cmake.run', () => cmdRun(context)),
    vscode.commands.registerCommand('null-cpp.cmake.buildAndRun', () => cmdBuildAndRun(context))
  );

  void (async () => {
    uiState.presets = [];
    if (isEnabled()) {
      await toolchainRegistry.refresh();
    }
    await reloadPresets();
    const preset = activePreset(context);
    await setContext('presetSelected', !!preset);
    if (preset) {
      uiState.targets = await readCodemodelTargets(preset.binaryDir);
      await setContext('configured', uiState.targets.length > 0);
    }
    updateStatusBar(context);
  })();
}
