"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findEnclosingSymbol = findEnclosingSymbol;
exports.findSymbolByQualifiedName = findSymbolByQualifiedName;
function isPositionInRange(position, range) {
    if (position.line < range.start.line || position.line > range.end.line) {
        return false;
    }
    if (position.line === range.start.line && position.character < range.start.character) {
        return false;
    }
    if (position.line === range.end.line && position.character > range.end.character) {
        return false;
    }
    return true;
}
function findEnclosingSymbol(symbols, position, ancestors = []) {
    for (const node of symbols) {
        if (!isPositionInRange(position, node.range)) {
            continue;
        }
        const qualifiedName = [...ancestors, node.name].join('::');
        const childMatch = findEnclosingSymbol(node.children, position, [...ancestors, node.name]);
        return childMatch ?? { node, qualifiedName };
    }
    return undefined;
}
function findSymbolByQualifiedName(symbols, qualifiedName, ancestors = []) {
    for (const node of symbols) {
        const nodeName = [...ancestors, node.name].join('::');
        if (nodeName === qualifiedName) {
            return node;
        }
        const childMatch = findSymbolByQualifiedName(node.children, qualifiedName, [...ancestors, node.name]);
        if (childMatch) {
            return childMatch;
        }
    }
    return undefined;
}
//# sourceMappingURL=symbolTree.js.map