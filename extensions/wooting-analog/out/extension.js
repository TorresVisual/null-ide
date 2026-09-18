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
exports.activate = activate;
exports.deactivate = deactivate;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const analogKeyHandler_1 = require("./analogKeyHandler");
const wootingBridge_1 = require("./wootingBridge");
// ─── Config ──────────────────────────────────────────────────────────────────
const EXT_ID = 'wooting-analog';
function isEnabled() {
    return vscode.workspace.getConfiguration(EXT_ID).get('enabled', true);
}
function getThreshold() {
    return vscode.workspace
        .getConfiguration(EXT_ID)
        .get('deepThreshold', 0.55);
}
function getDllPath() {
    const configured = vscode.workspace
        .getConfiguration(EXT_ID)
        .get('dllPath', '');
    return configured || defaultDllPath();
}
function defaultDllPath() {
    const pf = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
    return path.join(pf, 'Wooting', 'wooting_analog_sdk.dll');
}
const BINDINGS = {
    'wooting.analogBackspace': {
        key: 'Backspace',
        light: 'deleteLeft',
        deep: 'deleteWordLeft',
    },
    'wooting.analogDelete': {
        key: 'Delete',
        light: 'deleteRight',
        deep: 'deleteWordRight',
    },
    'wooting.analogLeft': {
        key: 'Left',
        light: 'cursorLeft',
        deep: 'cursorWordLeft',
    },
    'wooting.analogRight': {
        key: 'Right',
        light: 'cursorRight',
        deep: 'cursorWordRight',
    },
    'wooting.analogUp': {
        key: 'Up',
        light: 'cursorUp',
        deep: 'cursorPageUp',
    },
    'wooting.analogDown': {
        key: 'Down',
        light: 'cursorDown',
        deep: 'cursorPageDown',
    },
    'wooting.analogEnter': {
        key: 'Enter',
        // light → normal newline via the built-in type command
        // deep  → open a new line below without breaking the current one
        light: '__type_newline__',
        deep: 'editor.action.insertLineAfter',
    },
};
// ─── Activation ──────────────────────────────────────────────────────────────
let bridge;
let handler;
function activate(context) {
    // Drives the `wooting-analog.enabled` guard in each keybinding's `when` clause,
    // so disabling the setting stops keys from being intercepted immediately —
    // without needing a reload. Reloading is only needed to load/unload the SDK.
    const enabledAtActivation = isEnabled();
    vscode.commands.executeCommand('setContext', 'wooting-analog.enabled', enabledAtActivation);
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (!e.affectsConfiguration(`${EXT_ID}.enabled`))
            return;
        const nowEnabled = isEnabled();
        vscode.commands.executeCommand('setContext', 'wooting-analog.enabled', nowEnabled);
        if (nowEnabled === enabledAtActivation)
            return;
        vscode.window
            .showInformationMessage('Wooting Analog: reload the window to fully apply this change.', 'Reload Window')
            .then(choice => {
            if (choice === 'Reload Window') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        });
    }));
    if (!enabledAtActivation)
        return;
    bridge = new wootingBridge_1.WootingBridge(getDllPath());
    if (!bridge.init()) {
        vscode.window.showWarningMessage([
            'Wooting Analog: SDK not found.',
            `Expected DLL at: ${getDllPath()}`,
            'Set wooting-analog.dllPath in settings if your install path differs.',
        ].join(' '));
        return;
    }
    handler = new analogKeyHandler_1.AnalogKeyHandler(bridge);
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
    const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusItem.text = '$(keyboard) Wooting';
    statusItem.tooltip = 'Wooting Analog Keys active';
    statusItem.show();
    context.subscriptions.push(statusItem);
}
function deactivate() {
    handler?.stop();
    bridge?.dispose();
}
// ─── Dispatch ─────────────────────────────────────────────────────────────────
function dispatch(command) {
    if (command === '__type_newline__') {
        vscode.commands.executeCommand('type', { text: '\n' });
    }
    else {
        vscode.commands.executeCommand(command);
    }
}
//# sourceMappingURL=extension.js.map