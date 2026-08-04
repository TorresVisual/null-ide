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
exports.getSymbols = getSymbols;
exports.invalidate = invalidate;
exports.findEnclosing = findEnclosing;
exports.findByQualifiedName = findByQualifiedName;
const vscode = __importStar(require("vscode"));
const symbolTree_1 = require("./symbolTree");
const cache = new Map();
function toSymbolNode(symbol) {
    return {
        name: symbol.name,
        range: {
            start: { line: symbol.range.start.line, character: symbol.range.start.character },
            end: { line: symbol.range.end.line, character: symbol.range.end.character },
        },
        children: symbol.children.map(toSymbolNode),
    };
}
async function getSymbols(doc) {
    const key = doc.uri.toString();
    const cached = cache.get(key);
    if (cached && cached.version === doc.version) {
        return cached.symbols;
    }
    // clangd's provider always returns hierarchical DocumentSymbol, never flat SymbolInformation.
    const result = (await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', doc.uri));
    const symbols = (result ?? []).map(toSymbolNode);
    cache.set(key, { version: doc.version, symbols });
    return symbols;
}
function invalidate(uri) {
    cache.delete(uri.toString());
}
async function findEnclosing(doc, position) {
    const symbols = await getSymbols(doc);
    return (0, symbolTree_1.findEnclosingSymbol)(symbols, { line: position.line, character: position.character });
}
async function findByQualifiedName(doc, qualifiedName) {
    const symbols = await getSymbols(doc);
    return (0, symbolTree_1.findSymbolByQualifiedName)(symbols, qualifiedName);
}
//# sourceMappingURL=symbolCache.js.map