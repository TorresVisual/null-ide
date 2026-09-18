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
exports.registerPairedSplit = registerPairedSplit;
const vscode = __importStar(require("vscode"));
const cppLanguage_1 = require("./cppLanguage");
const clangdBridge_1 = require("./clangdBridge");
const symbolCache_1 = require("./symbolCache");
const pairRegistry_1 = require("./pairRegistry");
const projectDetection_1 = require("./projectDetection");
const editorLookup_1 = require("./editorLookup");
const SCROLL_SYNC_DEBOUNCE_MS = 120;
function getConfig(key, fallback) {
    return vscode.workspace.getConfiguration('null-cpp').get(key, fallback);
}
function closeTab(uriString) {
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uriString) {
                void vscode.window.tabGroups.close(tab);
            }
        }
    }
}
async function syncScroll(doc, position, counterpartEditor) {
    const enclosing = await (0, symbolCache_1.findEnclosing)(doc, position);
    if (!enclosing) {
        return;
    }
    const match = await (0, symbolCache_1.findByQualifiedName)(counterpartEditor.document, enclosing.qualifiedName);
    if (!match) {
        return;
    }
    const range = new vscode.Range(new vscode.Position(match.range.start.line, match.range.start.character), new vscode.Position(match.range.end.line, match.range.end.character));
    counterpartEditor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}
function registerPairedSplit(context) {
    const registry = new pairRegistry_1.PairRegistry();
    let debounceTimer;
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(async (doc) => {
        if (!(0, projectDetection_1.isEnabled)() || !getConfig('autoPairSplit.enabled', true) || !(0, cppLanguage_1.isCppDocument)(doc)) {
            return;
        }
        const key = doc.uri.toString();
        if (registry.has(key)) {
            return;
        }
        const result = await (0, clangdBridge_1.switchSourceHeader)(doc.uri);
        if (result.kind !== 'switched') {
            return;
        }
        const counterpartKey = result.uri.toString();
        const alreadyVisible = (0, editorLookup_1.findVisibleEditor)(counterpartKey) !== undefined;
        registry.record(key, counterpartKey);
        if (alreadyVisible) {
            return;
        }
        const counterpartDoc = await vscode.workspace.openTextDocument(result.uri);
        await vscode.window.showTextDocument(counterpartDoc, {
            viewColumn: vscode.ViewColumn.Beside,
            preserveFocus: true,
            preview: false,
        });
    }), vscode.workspace.onDidCloseTextDocument((doc) => {
        if (!(0, projectDetection_1.isEnabled)()) {
            return;
        }
        const key = doc.uri.toString();
        const counterpart = registry.getCounterpart(key);
        registry.remove(key);
        (0, symbolCache_1.invalidate)(doc.uri);
        if (counterpart && getConfig('pairedSplit.autoCloseCounterpart', false)) {
            closeTab(counterpart);
        }
    }), vscode.window.onDidChangeTextEditorSelection((event) => {
        if (!(0, projectDetection_1.isEnabled)() || !getConfig('scrollSync.enabled', true)) {
            return;
        }
        const doc = event.textEditor.document;
        const counterpartKey = registry.getCounterpart(doc.uri.toString());
        if (!counterpartKey) {
            return;
        }
        const counterpartEditor = (0, editorLookup_1.findVisibleEditor)(counterpartKey);
        if (!counterpartEditor) {
            return;
        }
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        const position = event.selections[0].active;
        debounceTimer = setTimeout(() => {
            void syncScroll(doc, position, counterpartEditor);
        }, SCROLL_SYNC_DEBOUNCE_MS);
    }));
}
//# sourceMappingURL=pairedSplit.js.map