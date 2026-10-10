'use strict';
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.keyUi = void 0;
const os = __importStar(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const vscode = __importStar(require("vscode"));
/** The real editor interactions behind `KeyActions`. */
exports.keyUi = {
    async confirm(message, detail, action) {
        return (await vscode.window.showWarningMessage(message, { modal: true, detail }, action)) === action;
    },
    info: (message, ...actions) => Promise.resolve(vscode.window.showInformationMessage(message, ...actions)),
    warn: (message, ...actions) => Promise.resolve(vscode.window.showWarningMessage(message, ...actions)),
    copy: text => Promise.resolve(vscode.env.clipboard.writeText(text)),
    async open(url) { await vscode.env.openExternal(vscode.Uri.parse(url)); },
    async pickKeyFile() {
        const picked = await vscode.window.showOpenDialog({
            title: 'Choose the private SSH key',
            openLabel: 'Use this key',
            canSelectMany: false,
            canSelectFolders: false,
            defaultUri: vscode.Uri.file(node_path_1.default.join(os.homedir(), '.ssh')),
        });
        return picked?.[0]?.fsPath;
    },
};
//# sourceMappingURL=keyUi.js.map