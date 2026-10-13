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
    context.subscriptions.push(vscode.commands.registerCommand('null-format.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:null.null-format')), vscode.commands.registerCommand('null-format.createPrettierConfig', () => createConfigFile('.prettierrc.json', extensionPath, 'defaults/.prettierrc.json')), vscode.commands.registerCommand('null-format.createClangFormatConfig', () => createConfigFile('.clang-format', extensionPath, 'defaults/.clang-format')), vscode.commands.registerCommand('null-format.createRustfmtConfig', () => createConfigFile('rustfmt.toml', extensionPath, 'defaults/rustfmt.toml')));
}
async function createConfigFile(fileName, extensionPath, relativeDefaultPath) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder is open to create a configuration file in.');
        return;
    }
    let targetFolder = folders[0];
    if (folders.length > 1) {
        const selected = await vscode.window.showWorkspaceFolderPick({
            placeHolder: `Select workspace folder for ${fileName}`,
        });
        if (!selected) {
            return;
        }
        targetFolder = selected;
    }
    const targetUri = vscode.Uri.joinPath(targetFolder.uri, fileName);
    try {
        try {
            await vscode.workspace.fs.stat(targetUri);
            const action = await vscode.window.showInformationMessage(`${fileName} already exists in ${targetFolder.name}.`, 'Open File');
            if (action === 'Open File') {
                const doc = await vscode.workspace.openTextDocument(targetUri);
                await vscode.window.showTextDocument(doc);
            }
            return;
        }
        catch {
            // File does not exist, proceed
        }
        let defaultContent = '';
        const defaultFullPath = vscode.Uri.joinPath(vscode.Uri.file(extensionPath), relativeDefaultPath);
        try {
            const bytes = await vscode.workspace.fs.readFile(defaultFullPath);
            defaultContent = new TextDecoder().decode(bytes);
        }
        catch {
            // Fallback content if default file cannot be read
            if (fileName === '.prettierrc.json') {
                defaultContent = '{\n  "semi": true,\n  "singleQuote": false,\n  "tabWidth": 2,\n  "trailingComma": "all"\n}\n';
            }
            else if (fileName === '.clang-format') {
                defaultContent = 'BasedOnStyle: LLVM\nIndentWidth: 4\nTabWidth: 4\nUseTab: Never\nColumnLimit: 100\n';
            }
            else if (fileName === 'rustfmt.toml') {
                defaultContent = 'edition = "2021"\nmax_width = 100\ntab_spaces = 4\n';
            }
        }
        const encoder = new TextEncoder();
        await vscode.workspace.fs.writeFile(targetUri, encoder.encode(defaultContent));
        const doc = await vscode.workspace.openTextDocument(targetUri);
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage(`Created ${fileName} in ${targetFolder.name}`);
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to create ${fileName}: ${err instanceof Error ? err.message : String(err)}`);
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map