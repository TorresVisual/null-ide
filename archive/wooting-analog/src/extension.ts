import * as path from 'path';
import * as vscode from 'vscode';
import { AnalogKeyHandler } from './analogKeyHandler';
import type { HIDKey } from './wootingBridge';
import { WootingBridge } from './wootingBridge';

// ─── Config ──────────────────────────────────────────────────────────────────

const EXT_ID = 'wooting-analog';

function isEnabled(): boolean {
  return vscode.workspace.getConfiguration(EXT_ID).get<boolean>('enabled', true);
}

function getThreshold(): number {
  return vscode.workspace
    .getConfiguration(EXT_ID)
    .get<number>('deepThreshold', 0.55);
}

function getDllPath(): string {
  const configured = vscode.workspace
    .getConfiguration(EXT_ID)
    .get<string>('dllPath', '');
  return configured || defaultDllPath();
}

function defaultDllPath(): string {
  const pf = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
  return path.join(pf, 'Wooting', 'wooting_analog_sdk.dll');
}

// ─── Binding table ───────────────────────────────────────────────────────────
//
// Each entry: command name → { key, light action, deep action }
//
// Light  = shallow press  (depth < threshold)
// Deep   = deliberate press (depth >= threshold)
//

interface Binding {
  key: HIDKey;
  light: string;
  deep: string;
}

const BINDINGS: Record<string, Binding> = {
  'wooting.analogBackspace': {
    key:   'Backspace',
    light: 'deleteLeft',
    deep:  'deleteWordLeft',
  },
  'wooting.analogDelete': {
    key:   'Delete',
    light: 'deleteRight',
    deep:  'deleteWordRight',
  },
  'wooting.analogLeft': {
    key:   'Left',
    light: 'cursorLeft',
    deep:  'cursorWordLeft',
  },
  'wooting.analogRight': {
    key:   'Right',
    light: 'cursorRight',
    deep:  'cursorWordRight',
  },
  'wooting.analogUp': {
    key:   'Up',
    light: 'cursorUp',
    deep:  'cursorPageUp',
  },
  'wooting.analogDown': {
    key:   'Down',
    light: 'cursorDown',
    deep:  'cursorPageDown',
  },
  'wooting.analogEnter': {
    key:   'Enter',
    // light → normal newline via the built-in type command
    // deep  → open a new line below without breaking the current one
    light: '__type_newline__',
    deep:  'editor.action.insertLineAfter',
  },
};

// ─── Activation ──────────────────────────────────────────────────────────────

let bridge: WootingBridge;
let handler: AnalogKeyHandler;

export function activate(context: vscode.ExtensionContext): void {
  // Drives the `wooting-analog.enabled` guard in each keybinding's `when` clause,
  // so disabling the setting stops keys from being intercepted immediately —
  // without needing a reload. Reloading is only needed to load/unload the SDK.
  const enabledAtActivation = isEnabled();
  vscode.commands.executeCommand('setContext', 'wooting-analog.enabled', enabledAtActivation);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration(`${EXT_ID}.enabled`)) return;
      const nowEnabled = isEnabled();
      vscode.commands.executeCommand('setContext', 'wooting-analog.enabled', nowEnabled);
      if (nowEnabled === enabledAtActivation) return;
      vscode.window
        .showInformationMessage(
          'Wooting Analog: reload the window to fully apply this change.',
          'Reload Window'
        )
        .then(choice => {
          if (choice === 'Reload Window') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        });
    })
  );

  if (!enabledAtActivation) return;

  bridge = new WootingBridge(getDllPath());

  if (!bridge.init()) {
    vscode.window.showWarningMessage(
      [
        'Wooting Analog: SDK not found.',
        `Expected DLL at: ${getDllPath()}`,
        'Set wooting-analog.dllPath in settings if your install path differs.',
      ].join(' ')
    );
    return;
  }

  handler = new AnalogKeyHandler(bridge);
  handler.start();

  // Register one command per binding
  for (const [command, binding] of Object.entries(BINDINGS)) {
    const disposable = vscode.commands.registerCommand(command, () => {
      const depth = handler.peakDepth(binding.key);
      const isDeep = depth >= getThreshold();
      dispatch(isDeep ? binding.deep : binding.light);
    });
    context.subscriptions.push(disposable);
  }

  // Status bar indicator
  const statusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusItem.text = '$(keyboard) Wooting';
  statusItem.tooltip = 'Wooting Analog Keys active';
  statusItem.show();
  context.subscriptions.push(statusItem);
}

export function deactivate(): void {
  handler?.stop();
  bridge?.dispose();
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

function dispatch(command: string): void {
  if (command === '__type_newline__') {
    vscode.commands.executeCommand('type', { text: '\n' });
  } else {
    vscode.commands.executeCommand(command);
  }
}
