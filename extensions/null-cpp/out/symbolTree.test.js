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
const node_test_1 = require("node:test");
const assert = __importStar(require("node:assert/strict"));
const symbolTree_1 = require("./symbolTree");
function tree() {
    return [
        {
            name: 'Foo',
            range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } },
            children: [
                {
                    name: 'Bar',
                    range: { start: { line: 1, character: 0 }, end: { line: 9, character: 1 } },
                    children: [
                        {
                            name: 'baz',
                            range: { start: { line: 3, character: 2 }, end: { line: 6, character: 3 } },
                            children: [],
                        },
                    ],
                },
            ],
        },
    ];
}
(0, node_test_1.test)('findEnclosingSymbol returns the innermost symbol containing the position', () => {
    const result = (0, symbolTree_1.findEnclosingSymbol)(tree(), { line: 4, character: 5 });
    assert.equal(result?.qualifiedName, 'Foo::Bar::baz');
});
(0, node_test_1.test)('findEnclosingSymbol falls back to an outer symbol when no child contains the position', () => {
    const result = (0, symbolTree_1.findEnclosingSymbol)(tree(), { line: 0, character: 5 });
    assert.equal(result?.qualifiedName, 'Foo');
});
(0, node_test_1.test)('findEnclosingSymbol returns undefined when nothing contains the position', () => {
    const result = (0, symbolTree_1.findEnclosingSymbol)(tree(), { line: 20, character: 0 });
    assert.equal(result, undefined);
});
(0, node_test_1.test)('findEnclosingSymbol treats range boundaries as inclusive', () => {
    const atStart = (0, symbolTree_1.findEnclosingSymbol)(tree(), { line: 3, character: 2 });
    const atEnd = (0, symbolTree_1.findEnclosingSymbol)(tree(), { line: 6, character: 3 });
    assert.equal(atStart?.qualifiedName, 'Foo::Bar::baz');
    assert.equal(atEnd?.qualifiedName, 'Foo::Bar::baz');
});
(0, node_test_1.test)('findSymbolByQualifiedName finds a nested symbol', () => {
    const match = (0, symbolTree_1.findSymbolByQualifiedName)(tree(), 'Foo::Bar::baz');
    assert.equal(match?.name, 'baz');
});
(0, node_test_1.test)('findSymbolByQualifiedName finds a top-level symbol', () => {
    const match = (0, symbolTree_1.findSymbolByQualifiedName)(tree(), 'Foo');
    assert.equal(match?.name, 'Foo');
});
(0, node_test_1.test)('findSymbolByQualifiedName returns undefined for an unknown name', () => {
    assert.equal((0, symbolTree_1.findSymbolByQualifiedName)(tree(), 'Foo::Bar::nope'), undefined);
});
//# sourceMappingURL=symbolTree.test.js.map