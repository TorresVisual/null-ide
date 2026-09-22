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
exports.PrettierFormattingEditProvider = void 0;
const vscode = __importStar(require("vscode"));
const prettier = __importStar(require("prettier"));
const diffUtils_1 = require("./diffUtils");
const LANGUAGE_PARSER_MAP = {
    javascript: 'babel',
    javascriptreact: 'babel',
    typescript: 'typescript',
    typescriptreact: 'typescript',
    json: 'json',
    jsonc: 'json',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    yaml: 'yaml',
    markdown: 'markdown',
};
class PrettierFormattingEditProvider {
    async provideDocumentFormattingEdits(document, options, token) {
        return this.formatInternal(document, undefined, options, token);
    }
    async provideDocumentRangeFormattingEdits(document, range, options, token) {
        return this.formatInternal(document, range, options, token);
    }
    async formatInternal(document, range, formattingOptions, token) {
        const config = vscode.workspace.getConfiguration('null-format.prettier');
        const enabled = config.get('enable', true);
        if (!enabled || token.isCancellationRequested) {
            return [];
        }
        const text = document.getText();
        const filePath = document.isUntitled ? undefined : document.fileName;
        const customConfigPath = config.get('configPath');
        const defaultConfig = config.get('defaultConfig') || {};
        let prettierConfig = null;
        if (customConfigPath && customConfigPath.trim().length > 0) {
            try {
                prettierConfig = await prettier.resolveConfig(customConfigPath, {
                    config: customConfigPath,
                    useCache: false,
                });
            }
            catch (err) {
                console.warn(`[null-format] Failed to load custom Prettier config at ${customConfigPath}:`, err);
            }
        }
        if (!prettierConfig && filePath) {
            try {
                prettierConfig = await prettier.resolveConfig(filePath, {
                    editorconfig: true,
                });
            }
            catch (err) {
                console.warn(`[null-format] Prettier resolveConfig error for ${filePath}:`, err);
            }
        }
        const parser = LANGUAGE_PARSER_MAP[document.languageId];
        const resolvedOptions = {
            filepath: filePath,
            parser,
            tabWidth: formattingOptions.tabSize,
            useTabs: !formattingOptions.insertSpaces,
            ...defaultConfig,
            ...(prettierConfig || {}),
        };
        if (range) {
            resolvedOptions.rangeStart = document.offsetAt(range.start);
            resolvedOptions.rangeEnd = document.offsetAt(range.end);
        }
        try {
            const formatted = await prettier.format(text, resolvedOptions);
            if (token.isCancellationRequested || formatted === text) {
                return [];
            }
            const minimalEdits = (0, diffUtils_1.computeMinimalEdits)(text, formatted);
            return minimalEdits.map((edit) => new vscode.TextEdit(new vscode.Range(new vscode.Position(edit.startLine, edit.startChar), new vscode.Position(edit.endLine, edit.endChar)), edit.newText));
        }
        catch (err) {
            console.error('[null-format] Prettier formatting failed:', err);
            vscode.window.showWarningMessage(`Prettier format error: ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }
}
exports.PrettierFormattingEditProvider = PrettierFormattingEditProvider;
//# sourceMappingURL=prettierProvider.js.map