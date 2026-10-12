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
const commitValidation_1 = require("./commitValidation");
(0, node_test_1.test)('valid messages', () => {
    for (const m of [
        'feat: add dark mode',
        'fix(git): handle missing remote',
        'feat(api)!: remove deprecated endpoint',
        'chore: x\n\nbody: with colons\nBREAKING CHANGE: y',
        'Merge branch main into x',
        'fixup! feat: a',
        '',
    ])
        assert.strictEqual((0, commitValidation_1.validateCommitMessage)(m), undefined, m);
});
(0, node_test_1.test)('invalid messages explain the fix', () => {
    assert.match((0, commitValidation_1.validateCommitMessage)('updated the settings page'), /type: description/);
    assert.match((0, commitValidation_1.validateCommitMessage)('fix - resolve startup crash'), /type: description/);
    assert.match((0, commitValidation_1.validateCommitMessage)('updated: the settings page'), /Unknown type "updated"/);
    assert.match((0, commitValidation_1.validateCommitMessage)('feat():x'), /scope/);
    assert.match((0, commitValidation_1.validateCommitMessage)('feat:'), /description/);
    assert.match((0, commitValidation_1.validateCommitMessage)('feat:add dark mode'), /space after the colon/);
});
(0, node_test_1.test)('typos in the type get a suggestion', () => {
    assert.strictEqual((0, commitValidation_1.suggestType)('feet'), 'feat');
    assert.strictEqual((0, commitValidation_1.suggestType)('fiz'), 'fix');
    assert.strictEqual((0, commitValidation_1.suggestType)('Feat'), 'feat');
    assert.strictEqual((0, commitValidation_1.suggestType)('refacotr'), 'refactor');
    assert.strictEqual((0, commitValidation_1.suggestType)('feature'), 'feat');
    assert.strictEqual((0, commitValidation_1.suggestType)('updated'), undefined);
    assert.match((0, commitValidation_1.validateCommitMessage)('feet: add dark mode'), /Did you mean "feat"\?/);
    assert.match((0, commitValidation_1.validateCommitMessage)('Fix: crash'), /Did you mean "fix"\?/);
});
//# sourceMappingURL=commitValidation.test.js.map