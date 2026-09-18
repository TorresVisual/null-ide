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
exports.registerSwitchSourceHeader = registerSwitchSourceHeader;
const vscode = __importStar(require("vscode"));
const cppLanguage_1 = require("./cppLanguage");
const clangdBridge_1 = require("./clangdBridge");
const symbolCache_1 = require("./symbolCache");
const projectDetection_1 = require("./projectDetection");
const editorLookup_1 = require("./editorLookup");
function registerSwitchSourceHeader(context) {
    context.subscriptions.push(vscode.commands.registerCommand('null-cpp.switchSourceHeader', async () => {
        if (!(0, projectDetection_1.isEnabled)()) {
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor || !(0, cppLanguage_1.isCppDocument)(editor.document)) {
            return;
        }
        const enclosing = await (0, symbolCache_1.findEnclosing)(editor.document, editor.selection.active);
        const result = await (0, clangdBridge_1.switchSourceHeader)(editor.document.uri);
        if (result.kind !== 'switched') {
            return;
        }
        const existingEditor = (0, editorLookup_1.findVisibleEditor)(result.uri.toString());
        const counterpartDoc = await vscode.workspace.openTextDocument(result.uri);
        const counterpartEditor = await vscode.window.showTextDocument(counterpartDoc, {
            viewColumn: existingEditor ? existingEditor.viewColumn : vscode.ViewColumn.Beside,
        });
        if (!enclosing) {
            return;
        }
        const match = await (0, symbolCache_1.findByQualifiedName)(counterpartDoc, enclosing.qualifiedName);
        if (!match) {
            return;
        }
        const range = new vscode.Range(new vscode.Position(match.range.start.line, match.range.start.character), new vscode.Position(match.range.end.line, match.range.end.character));
        counterpartEditor.selection = new vscode.Selection(range.start, range.start);
        counterpartEditor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }));
}
//# sourceMappingURL=symbolSwitch.js.map