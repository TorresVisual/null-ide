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
const vscode = __importStar(require("vscode"));
const commands_1 = require("./commands");
const detect_1 = require("./detect");
const envState_1 = require("./envState");
const fix_1 = require("./fix");
const probe_1 = require("./probe");
const probes_1 = require("./probes");
const statusBar_1 = require("./statusBar");
function activate(context) {
    const state = new envState_1.EnvState(probes_1.vscodeProbes, context.workspaceState);
    context.subscriptions.push(state, vscode.workspace.onDidChangeWorkspaceFolders(() => state.refresh()), vscode.extensions.onDidChange(() => state.refresh()));
    (0, commands_1.registerCommands)(context, state);
    (0, statusBar_1.registerStatusBar)(context, state);
    state.refresh();
    return {
        getFindings: () => state.get(),
        onDidChange: state.onDidChange,
        detectProjects: folderPath => (0, detect_1.detectProjects)(folderPath),
        findExecutable: name => (0, probe_1.findExecutable)(name),
        findRustfmtPath: probe_1.findRustfmtPath,
        findClangFormatPath: probe_1.findClangFormatPath,
        ensureDebugType: fix_1.ensureDebugType,
    };
}
function deactivate() { }
//# sourceMappingURL=extension.js.map