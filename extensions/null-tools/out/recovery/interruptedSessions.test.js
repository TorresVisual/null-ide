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
const interruptedSessions_1 = require("./interruptedSessions");
const asst = (stop, extra = {}) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', stop_reason: stop, content: [{ type: 'text', text: 'ok' }] }, ...extra });
const user = (content, extra = {}) => JSON.stringify({ type: 'user', message: { role: 'user', content }, ...extra });
const lines = (...l) => l.join('\n') + '\n';
(0, node_test_1.test)('a transcript ending in an assistant end_turn is completed', () => {
    assert.equal((0, interruptedSessions_1.classifyLastTurn)(lines(user('hi'), asst('end_turn'))), 'completed');
});
(0, node_test_1.test)('a transcript ending in an assistant tool_use is interrupted', () => {
    assert.equal((0, interruptedSessions_1.classifyLastTurn)(lines(user('hi'), asst('tool_use'))), 'interrupted');
    assert.equal((0, interruptedSessions_1.classifyLastTurn)(lines(user('hi'), asst(null))), 'interrupted');
});
(0, node_test_1.test)('a transcript ending in a user entry (prompt or tool result) is interrupted', () => {
    assert.equal((0, interruptedSessions_1.classifyLastTurn)(lines(asst('end_turn'), user('next question'))), 'interrupted');
    assert.equal((0, interruptedSessions_1.classifyLastTurn)(lines(asst('tool_use'), user([{ type: 'tool_result', content: 'x' }]))), 'interrupted');
});
(0, node_test_1.test)('a user-initiated interrupt is a deliberate stop, not a crash', () => {
    const stop = user([{ type: 'text', text: '[Request interrupted by user]' }]);
    assert.equal((0, interruptedSessions_1.classifyLastTurn)(lines(asst('tool_use'), stop)), 'completed');
});
(0, node_test_1.test)('a torn final line is skipped and the previous turn decides', () => {
    assert.equal((0, interruptedSessions_1.classifyLastTurn)(lines(user('hi'), asst('end_turn')) + '{"type":"assis'), 'completed');
    assert.equal((0, interruptedSessions_1.classifyLastTurn)(lines(user('hi'), asst('tool_use')) + '{"type":"assis'), 'interrupted');
});
(0, node_test_1.test)('non-conversation, sidechain and meta entries are ignored', () => {
    const noise = [
        JSON.stringify({ type: 'attachment' }),
        asst('tool_use', { isSidechain: true }),
        user('meta text', { isMeta: true }),
    ];
    assert.equal((0, interruptedSessions_1.classifyLastTurn)(lines(user('hi'), asst('end_turn'), ...noise)), 'completed');
});
(0, node_test_1.test)('a transcript with no conversation entries is unknown', () => {
    assert.equal((0, interruptedSessions_1.classifyLastTurn)(''), 'unknown');
    assert.equal((0, interruptedSessions_1.classifyLastTurn)(lines(JSON.stringify({ type: 'summary' }))), 'unknown');
});
(0, node_test_1.test)('firstPromptTitle skips wrappers, tool results and meta, and truncates', () => {
    const head = lines(user('<command-name>/clear</command-name>'), user([{ type: 'tool_result', content: 'x' }]), user('real   question\nabout things', { isMeta: false }));
    assert.equal((0, interruptedSessions_1.firstPromptTitle)(head), 'real question about things');
    assert.equal((0, interruptedSessions_1.firstPromptTitle)(lines(user('x'.repeat(200))))?.length, 80);
    assert.equal((0, interruptedSessions_1.firstPromptTitle)(lines(asst('end_turn'))), undefined);
    assert.equal((0, interruptedSessions_1.firstPromptTitle)(user([{ type: 'text', text: 'array form' }])), 'array form');
});
function transcript(dir, id, body, mtimeMs) {
    const file = path.join(dir, `${id}.jsonl`);
    fs.writeFileSync(file, body);
    fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
}
(0, node_test_1.test)('scanSessions keeps transcripts in [from, until), newest first, with state and title', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-recovery-sessions-'));
    try {
        const T = Date.parse('2026-01-01T00:00:00Z');
        transcript(dir, 'before', lines(user('old'), asst('end_turn')), T - 5000);
        transcript(dir, 'done', lines(user('finished work'), asst('end_turn')), T + 1000);
        transcript(dir, 'cut', lines(user('long task'), asst('tool_use')), T + 2000);
        transcript(dir, 'live', lines(user('another window'), asst('tool_use')), T + 9000); // written after this window started
        transcript(dir, 'empty', '', T + 1500);
        transcript(dir, 'notes', lines(JSON.stringify({ type: 'summary' })), T + 1600);
        fs.writeFileSync(path.join(dir, 'readme.txt'), 'not a transcript');
        assert.deepEqual((0, interruptedSessions_1.scanSessions)(dir, T, T + 5000), [
            { sessionId: 'cut', title: 'long task', lastActivity: T + 2000, interrupted: true },
            { sessionId: 'done', title: 'finished work', lastActivity: T + 1000, interrupted: false },
        ]);
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('scanSessions on a missing directory returns an empty list', () => {
    assert.deepEqual((0, interruptedSessions_1.scanSessions)(path.join(os.tmpdir(), 'null-recovery-nope'), 0, 1), []);
});
//# sourceMappingURL=interruptedSessions.test.js.map