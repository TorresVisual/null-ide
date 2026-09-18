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
exports.switchSourceHeader = switchSourceHeader;
const vscode = __importStar(require("vscode"));
const CLANGD_EXTENSION_ID = 'llvm-vs-code-extensions.vscode-clangd';
let cachedClient;
let warnedMissingApi = false;
async function switchSourceHeader(uri) {
    const ext = vscode.extensions.getExtension(CLANGD_EXTENSION_ID);
    if (!ext) {
        return { kind: 'unavailable' };
    }
    const exports = ext.isActive ? ext.exports : await ext.activate();
    if (typeof exports.getApi !== 'function') {
        if (!warnedMissingApi) {
            warnedMissingApi = true;
            void vscode.window.showWarningMessage('Null C++ needs a newer version of the clangd extension (0.1.29+) for symbol-aware navigation. Falling back to plain Alt+O.');
        }
        await vscode.commands.executeCommand('clangd.switchheadersource');
        return { kind: 'fallback' };
    }
    if (!cachedClient) {
        cachedClient = exports.getApi(1).languageClient;
    }
    const result = await cachedClient.sendRequest('textDocument/switchSourceHeader', { uri: uri.toString() });
    if (!result) {
        return { kind: 'not-found' };
    }
    return { kind: 'switched', uri: vscode.Uri.parse(result) };
}
//# sourceMappingURL=clangdBridge.js.map