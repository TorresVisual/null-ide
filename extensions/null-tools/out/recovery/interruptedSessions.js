'use strict';
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
exports.classifyLastTurn = classifyLastTurn;
exports.firstPromptTitle = firstPromptTitle;
exports.scanSessions = scanSessions;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const CHUNK_BYTES = 64 * 1024;
const TITLE_MAX = 80;
// stop reasons that mean the assistant's turn ran to its end
const FINISHED = new Set(['end_turn', 'stop_sequence', 'max_tokens']);
function parseEntry(line) {
    try {
        const v = JSON.parse(line);
        return v && typeof v === 'object' ? v : null;
    }
    catch {
        return null; // blank, or a line cut by a crash / chunk boundary
    }
}
function textOf(content) {
    if (typeof content === 'string')
        return content;
    if (!Array.isArray(content))
        return '';
    return content
        .map(c => (c && c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
        .join(' ');
}
function isConversation(e) {
    return (e.type === 'user' || e.type === 'assistant') && !e.isSidechain && !e.isMeta;
}
// Looks at the last user/assistant entry only: a finished assistant turn means
// the session ended cleanly; anything else (dangling tool_use, an unanswered
// prompt or tool result) means it was cut off.
function classifyLastTurn(tail) {
    const all = tail.split('\n');
    for (let i = all.length - 1; i >= 0; i--) {
        const entry = parseEntry(all[i]);
        if (!entry || !isConversation(entry))
            continue;
        if (entry.type === 'assistant') {
            return FINISHED.has(entry.message?.stop_reason ?? '') ? 'completed' : 'interrupted';
        }
        const stoppedByUser = textOf(entry.message?.content).includes('[Request interrupted by user');
        return stoppedByUser ? 'completed' : 'interrupted';
    }
    return 'unknown';
}
function firstPromptTitle(head) {
    for (const line of head.split('\n')) {
        const entry = parseEntry(line);
        if (!entry || entry.type !== 'user' || !isConversation(entry))
            continue;
        const text = textOf(entry.message?.content).replace(/\s+/g, ' ').trim();
        if (!text || text.startsWith('<'))
            continue; // slash-command / system wrappers
        return text.length > TITLE_MAX ? text.slice(0, TITLE_MAX - 1) + '…' : text;
    }
    return undefined;
}
function readChunk(file, size, fromEnd) {
    const fd = fs.openSync(file, 'r');
    try {
        const length = Math.min(size, CHUNK_BYTES);
        const buf = Buffer.alloc(length);
        fs.readSync(fd, buf, 0, length, fromEnd ? size - length : 0);
        return buf.toString('utf8');
    }
    finally {
        fs.closeSync(fd);
    }
}
// Transcripts written in [fromMs, untilMs): from the crashed run's start up to
// this window's start. Later writes belong to windows that are still running.
function scanSessions(projectDir, fromMs, untilMs) {
    let entries;
    try {
        entries = fs.readdirSync(projectDir);
    }
    catch {
        return [];
    }
    const found = [];
    for (const entry of entries) {
        if (!entry.endsWith('.jsonl'))
            continue;
        const file = path.join(projectDir, entry);
        try {
            const { mtimeMs, size } = fs.statSync(file);
            if (size === 0 || mtimeMs < fromMs || mtimeMs >= untilMs)
                continue;
            const state = classifyLastTurn(readChunk(file, size, true));
            if (state === 'unknown')
                continue;
            const sessionId = entry.slice(0, -'.jsonl'.length);
            found.push({
                sessionId,
                title: firstPromptTitle(readChunk(file, size, false)) ?? sessionId.slice(0, 8),
                lastActivity: mtimeMs,
                interrupted: state === 'interrupted',
            });
        }
        catch {
            // unreadable transcript: skip it, keep scanning
        }
    }
    return found.sort((a, b) => b.lastActivity - a.lastActivity);
}
//# sourceMappingURL=interruptedSessions.js.map