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
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const followAlong_1 = require("./followAlong");
(0, node_test_1.test)('encodeProjectPath lowercases the drive letter and flattens separators', () => {
    assert.equal((0, followAlong_1.encodeProjectPath)('D:\\Coding\\Apps\\null-ide'), 'd--Coding-Apps-null-ide');
});
(0, node_test_1.test)('findProjectDir matches case-insensitively', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'null-follow-along-'));
    try {
        fs.mkdirSync(path.join(root, 'D--Coding-Apps-null-ide'));
        const found = (0, followAlong_1.findProjectDir)(root, 'D:\\Coding\\Apps\\null-ide');
        assert.equal(found, path.join(root, 'D--Coding-Apps-null-ide'));
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('findProjectDir returns null when nothing matches', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'null-follow-along-'));
    try {
        assert.equal((0, followAlong_1.findProjectDir)(root, 'D:\\Other\\Repo'), null);
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('pickNewestTranscript picks the most recently modified .jsonl', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-follow-along-'));
    try {
        const older = path.join(dir, 'a.jsonl');
        const newer = path.join(dir, 'b.jsonl');
        fs.writeFileSync(older, '{}');
        fs.writeFileSync(path.join(dir, 'ignore.txt'), 'nope');
        fs.utimesSync(older, new Date(1000), new Date(1000));
        fs.writeFileSync(newer, '{}');
        fs.utimesSync(newer, new Date(2000), new Date(2000));
        assert.equal((0, followAlong_1.pickNewestTranscript)(dir), newer);
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('isPathInWorkspace rejects paths outside the workspace root', () => {
    assert.equal((0, followAlong_1.isPathInWorkspace)('C:\\repo\\src\\a.ts', 'C:\\repo'), true);
    assert.equal((0, followAlong_1.isPathInWorkspace)('C:\\other\\a.ts', 'C:\\repo'), false);
    assert.equal((0, followAlong_1.isPathInWorkspace)('C:\\repo', 'C:\\repo'), false);
});
(0, node_test_1.test)('parseAppendedLines leaves a trailing partial line unconsumed', () => {
    const text = '{"a":1}\n{"b":2}\n{"c":3';
    const result = (0, followAlong_1.parseAppendedLines)(text);
    assert.deepEqual(result.lines, [{ a: 1 }, { b: 2 }]);
    assert.equal(result.consumedLength, text.lastIndexOf('\n') + 1);
});
(0, node_test_1.test)('parseAppendedLines skips malformed JSON lines', () => {
    const text = '{"a":1}\nnot json\n{"b":2}\n';
    const result = (0, followAlong_1.parseAppendedLines)(text);
    assert.deepEqual(result.lines, [{ a: 1 }, { b: 2 }]);
});
(0, node_test_1.test)('extractEdits pulls line ranges out of a structuredPatch', () => {
    const line = {
        type: 'user',
        toolUseResult: {
            filePath: 'C:\\repo\\src\\a.ts',
            structuredPatch: [{ newStart: 10, newLines: 3, lines: [] }],
        },
    };
    assert.deepEqual((0, followAlong_1.extractEdits)(line), [
        { filePath: 'C:\\repo\\src\\a.ts', newStart: 10, newLines: 3, addedLines: [], removedLines: [] },
    ]);
});
(0, node_test_1.test)('extractEdits classifies added and removed lines from the patch hunk', () => {
    const line = {
        type: 'user',
        toolUseResult: {
            filePath: 'C:\\repo\\src\\a.ts',
            structuredPatch: [{
                    newStart: 5,
                    newLines: 3,
                    lines: [' context', '-old line', '+new line', ' more context'],
                }],
        },
    };
    const [edit] = (0, followAlong_1.extractEdits)(line);
    assert.deepEqual(edit.addedLines, [6]);
    assert.deepEqual(edit.removedLines, [{ beforeLine: 6, text: 'old line' }]);
});
(0, node_test_1.test)('extractEdits ignores unrelated transcript lines', () => {
    assert.deepEqual((0, followAlong_1.extractEdits)({ type: 'user', toolUseResult: { stdout: 'ok' } }), []);
    assert.deepEqual((0, followAlong_1.extractEdits)({ type: 'assistant' }), []);
    assert.deepEqual((0, followAlong_1.extractEdits)(null), []);
});
//# sourceMappingURL=followAlong.test.js.map