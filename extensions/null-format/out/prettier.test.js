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
const prettier = __importStar(require("prettier"));
const diffUtils_1 = require("./diffUtils");
(0, node_test_1.describe)('prettier formatting integration', () => {
    (0, node_test_1.it)('formats javascript with default options', async () => {
        const unformatted = 'const   a=1; function   foo( x ){return x+a;}';
        const formatted = await prettier.format(unformatted, {
            parser: 'babel',
            semi: true,
            singleQuote: false,
            tabWidth: 2,
        });
        assert.strictEqual(formatted.trim(), 'const a = 1;\nfunction foo(x) {\n  return x + a;\n}');
        const edits = (0, diffUtils_1.computeMinimalEdits)(unformatted, formatted);
        assert.strictEqual(edits.length, 1);
    });
    (0, node_test_1.it)('formats json with default options', async () => {
        const unformatted = '{"a":1,"b":   [2,3]}';
        const formatted = await prettier.format(unformatted, {
            parser: 'json',
            tabWidth: 2,
        });
        assert.strictEqual(formatted.trim(), '{ "a": 1, "b": [2, 3] }');
    });
    (0, node_test_1.it)('formats typescript with custom options', async () => {
        const unformatted = 'interface User{name:string;age?:number;}';
        const formatted = await prettier.format(unformatted, {
            parser: 'typescript',
            semi: true,
            singleQuote: true,
            tabWidth: 4,
        });
        assert.strictEqual(formatted.trim(), 'interface User {\n    name: string;\n    age?: number;\n}');
    });
});
//# sourceMappingURL=prettier.test.js.map