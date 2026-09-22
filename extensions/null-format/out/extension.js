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
const prettierProvider_1 = require("./prettierProvider");
const rustfmtProvider_1 = require("./rustfmtProvider");
const clangFormatProvider_1 = require("./clangFormatProvider");
function activate(context) {
    const extensionPath = context.extensionPath;
    // 1. Register Prettier Formatter
    const prettierProvider = new prettierProvider_1.PrettierFormattingEditProvider();
    const prettierLanguages = [
        'javascript',
        'javascriptreact',
        'typescript',
        'typescriptreact',
        'json',
        'jsonc',
        'css',
        'scss',
        'less',
        'html',
        'yaml',
        'markdown',
    ];
    for (const lang of prettierLanguages) {
        context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(lang, prettierProvider), vscode.languages.registerDocumentRangeFormattingEditProvider(lang, prettierProvider));
    }
    // 2. Register Rustfmt Formatter
    const rustfmtProvider = new rustfmtProvider_1.RustfmtFormattingEditProvider(extensionPath);
    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('rust', rustfmtProvider));
    // 3. Register Clang-Format Formatter
    const clangFormatProvider = new clangFormatProvider_1.ClangFormatFormattingEditProvider(extensionPath);
    const clangLanguages = ['c', 'cpp', 'cuda-cpp', 'objective-c', 'objective-cpp'];
    for (const lang of clangLanguages) {
        context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(lang, clangFormatProvider), vscode.languages.registerDocumentRangeFormattingEditProvider(lang, clangFormatProvider));
    }
    // 4. Register Commands
    context.subscriptions.push(vscode.commands.registerCommand('null-format.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:null null-format')));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map