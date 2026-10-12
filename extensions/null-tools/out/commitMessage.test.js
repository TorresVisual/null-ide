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
const commitMessage_1 = require("./commitMessage");
(0, node_test_1.test)('single modified file', () => {
    assert.strictEqual((0, commitMessage_1.heuristicMessage)('M\tsrc/a.ts\n'), 'chore: update a.ts');
});
(0, node_test_1.test)('docs only', () => {
    assert.strictEqual((0, commitMessage_1.heuristicMessage)('M\tREADME.md\nA\tdocs/x.md\n'), 'docs: update README.md, x.md');
});
(0, node_test_1.test)('tests only, all added', () => {
    assert.strictEqual((0, commitMessage_1.heuristicMessage)('A\tsrc/a.test.ts\n'), 'test: add a.test.ts');
});
(0, node_test_1.test)('rename uses new path; many files are counted', () => {
    assert.strictEqual((0, commitMessage_1.heuristicMessage)('R100\told.ts\tnew.ts\n'), 'chore: update new.ts');
    assert.strictEqual((0, commitMessage_1.heuristicMessage)('M\ta\nM\tb\nM\tc\nD\td\n'), 'chore: update 4 files');
});
(0, node_test_1.test)('empty input', () => {
    assert.strictEqual((0, commitMessage_1.heuristicMessage)(''), 'chore: update files');
});
//# sourceMappingURL=commitMessage.test.js.map