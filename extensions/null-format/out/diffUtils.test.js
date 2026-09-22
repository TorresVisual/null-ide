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
const assert = __importStar(require("node:assert"));
const diffUtils_1 = require("./diffUtils");
(0, node_test_1.describe)('diffUtils', () => {
    (0, node_test_1.it)('returns empty array when text is identical', () => {
        const edits = (0, diffUtils_1.computeMinimalEdits)('const x = 1;\n', 'const x = 1;\n');
        assert.deepStrictEqual(edits, []);
    });
    (0, node_test_1.it)('computes minimal edit for middle modification', () => {
        const original = 'const x = 1;\nconst y = 2;\n';
        const formatted = 'const x = 1;\nconst y = 20;\n';
        const edits = (0, diffUtils_1.computeMinimalEdits)(original, formatted);
        assert.strictEqual(edits.length, 1);
        assert.strictEqual(edits[0].startLine, 1);
        assert.strictEqual(edits[0].startChar, 11);
        assert.strictEqual(edits[0].endLine, 1);
        assert.strictEqual(edits[0].endChar, 11);
        assert.strictEqual(edits[0].newText, '0');
    });
    (0, node_test_1.it)('computes minimal edit when adding lines', () => {
        const original = 'function foo() {\nreturn 1;\n}\n';
        const formatted = 'function foo() {\n  return 1;\n}\n';
        const edits = (0, diffUtils_1.computeMinimalEdits)(original, formatted);
        assert.strictEqual(edits.length, 1);
        assert.strictEqual(edits[0].newText, '  ');
    });
    (0, node_test_1.it)('correctly calculates line and character from offset', () => {
        const text = 'line 0\nline 1\nline 2';
        assert.deepStrictEqual((0, diffUtils_1.offsetToPosition)(text, 0), { line: 0, character: 0 });
        assert.deepStrictEqual((0, diffUtils_1.offsetToPosition)(text, 6), { line: 0, character: 6 });
        assert.deepStrictEqual((0, diffUtils_1.offsetToPosition)(text, 7), { line: 1, character: 0 });
        assert.deepStrictEqual((0, diffUtils_1.offsetToPosition)(text, 14), { line: 2, character: 0 });
        assert.deepStrictEqual((0, diffUtils_1.offsetToPosition)(text, 17), { line: 2, character: 3 });
    });
});
//# sourceMappingURL=diffUtils.test.js.map