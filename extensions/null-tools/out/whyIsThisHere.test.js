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
const whyIsThisHere_1 = require("./whyIsThisHere");
(0, node_test_1.test)('extractAddedLines keeps the text of added lines, not just numbers', () => {
    const line = {
        type: 'user',
        toolUseResult: {
            filePath: 'C:\\repo\\src\\a.ts',
            structuredPatch: [{ newStart: 5, newLines: 2, lines: [' context', '-old', '+new line', ' more'] }],
        },
    };
    assert.deepEqual((0, whyIsThisHere_1.extractAddedLines)(line), [
        { filePath: 'C:\\repo\\src\\a.ts', addedLines: [{ lineNumber: 6, text: 'new line' }] },
    ]);
});
(0, node_test_1.test)('extractAddedLines ignores unrelated transcript lines', () => {
    assert.deepEqual((0, whyIsThisHere_1.extractAddedLines)({ type: 'user', toolUseResult: { stdout: 'ok' } }), []);
    assert.deepEqual((0, whyIsThisHere_1.extractAddedLines)(null), []);
});
(0, node_test_1.test)('excerpt collapses whitespace and truncates with an ellipsis', () => {
    assert.equal((0, whyIsThisHere_1.excerpt)('  a   b\nc  ', 10), 'a b c');
    assert.equal((0, whyIsThisHere_1.excerpt)('a'.repeat(20), 5), 'aaaaa…');
});
function toolResultLine(uuid, parentUuid, filePath, addedText, lineNumber, timestamp) {
    return {
        type: 'user',
        uuid,
        parentUuid,
        timestamp,
        message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] },
        toolUseResult: { filePath, structuredPatch: [{ newStart: lineNumber, newLines: 1, lines: [`+${addedText}`] }] },
    };
}
(0, node_test_1.test)('WhyIndex resolves the prompt and the nearest preceding assistant text', () => {
    const index = new whyIsThisHere_1.WhyIndex('session-1');
    index.ingest([
        { type: 'user', uuid: 'u1', parentUuid: null, timestamp: '2026-01-01T00:00:00Z', message: { content: 'add a guard clause' } },
        { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { content: [{ type: 'text', text: 'Adding a null check.' }] } },
        { type: 'assistant', uuid: 'a2', parentUuid: 'a1', message: { content: [{ type: 'tool_use', id: 'toolu_1' }] } },
        toolResultLine('r1', 'a2', 'C:\\repo\\src\\a.ts', 'if (!x) return;', 10, '2026-01-01T00:00:05Z'),
    ]);
    const match = index.findAnnotation('C:\\repo\\src\\a.ts', 10, 'if (!x) return;');
    assert.ok(match);
    assert.equal(match.annotation.prompt, 'add a guard clause');
    assert.equal(match.annotation.claudeSaid, 'Adding a null check.');
    assert.equal(match.annotation.sessionId, 'session-1');
    assert.equal(match.annotation.timestamp, '2026-01-01T00:00:05Z');
});
(0, node_test_1.test)('WhyIndex skips tool-result round-trip lines when looking for the real user prompt', () => {
    const index = new whyIsThisHere_1.WhyIndex('session-2');
    index.ingest([
        { type: 'user', uuid: 'u1', parentUuid: null, message: { content: 'refactor this' } },
        { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { content: [{ type: 'tool_use', id: 'toolu_read' }] } },
        { type: 'user', uuid: 'r0', parentUuid: 'a1', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_read', content: 'file contents' }] } },
        { type: 'assistant', uuid: 'a2', parentUuid: 'r0', message: { content: [{ type: 'tool_use', id: 'toolu_edit' }] } },
        toolResultLine('r1', 'a2', 'C:\\repo\\b.ts', 'const y = 2;', 3),
    ]);
    const match = index.findAnnotation('C:\\repo\\b.ts', 3, 'const y = 2;');
    assert.equal(match?.annotation.prompt, 'refactor this');
});
(0, node_test_1.test)('WhyIndex picks up a later ai-title line for annotations already indexed', () => {
    const index = new whyIsThisHere_1.WhyIndex('session-3');
    index.ingest([
        { type: 'user', uuid: 'u1', parentUuid: null, message: { content: 'rename it' } },
        { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { content: [{ type: 'tool_use', id: 't' }] } },
        toolResultLine('r1', 'a1', 'C:\\repo\\c.ts', 'export const z = 1;', 1),
    ]);
    index.ingest([{ type: 'ai-title', aiTitle: 'Rename export', sessionId: 'session-3' }]);
    const match = index.findAnnotation('C:\\repo\\c.ts', 1, 'export const z = 1;');
    assert.equal(match?.annotation.sessionTitle, 'Rename export');
});
(0, node_test_1.test)('WhyIndex does not annotate an edit whose prompt is outside the ingested window', () => {
    const index = new whyIsThisHere_1.WhyIndex('session-4');
    index.ingest([toolResultLine('r1', 'missing-parent', 'C:\\repo\\d.ts', 'x();', 1)]);
    assert.equal(index.findAnnotation('C:\\repo\\d.ts', 1, 'x();'), null);
});
(0, node_test_1.test)('WhyIndex findAnnotation ignores trivial short lines and re-matches by content after drift', () => {
    const index = new whyIsThisHere_1.WhyIndex('session-5');
    index.ingest([
        { type: 'user', uuid: 'u1', parentUuid: null, message: { content: 'add logging' } },
        { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { content: [{ type: 'tool_use', id: 't' }] } },
        toolResultLine('r1', 'a1', 'C:\\repo\\e.ts', 'console.log(value);', 20),
    ]);
    // Trivial line — never matched, even at the exact recorded position.
    assert.equal(index.findAnnotation('C:\\repo\\e.ts', 1, '}'), null);
    // Content moved to a different line number — still matches by text.
    const match = index.findAnnotation('C:\\repo\\e.ts', 25, 'console.log(value);');
    assert.equal(match?.annotation.prompt, 'add logging');
});
//# sourceMappingURL=whyIsThisHere.test.js.map