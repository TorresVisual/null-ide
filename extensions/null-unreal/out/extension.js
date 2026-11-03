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
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const commands_1 = require("./commands");
const statusBar_1 = require("./statusBar");
const shim_1 = require("./shim");
// Returns the shim folder so the integration spec can check it; nothing else reads the return value.
function activate(context) {
    const shimDir = path.join(context.globalStorageUri.fsPath, 'bin');
    fs.mkdirSync(shimDir, { recursive: true });
    const cliPath = path.join(context.extensionPath, 'out', 'cli.js');
    for (const [name, body] of Object.entries((0, shim_1.shimFiles)(process.execPath, cliPath))) {
        fs.writeFileSync(path.join(shimDir, name), body);
    }
    context.environmentVariableCollection.prepend('PATH', shimDir + path.delimiter);
    const output = vscode.window.createOutputChannel('Null Unreal');
    (0, commands_1.registerCommands)(context, { cliPath, output, shimPath: path.join(shimDir, 'null-unreal.cmd') });
    context.subscriptions.push(output, (0, statusBar_1.createRunStatusBar)());
    return { shimDir };
}
function deactivate() { }
//# sourceMappingURL=extension.js.map