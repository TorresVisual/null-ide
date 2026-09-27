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
exports.encodeProjectPath = encodeProjectPath;
exports.findProjectDir = findProjectDir;
exports.pickNewestTranscript = pickNewestTranscript;
exports.isPathInWorkspace = isPathInWorkspace;
exports.parseAppendedLines = parseAppendedLines;
exports.extractEdits = extractEdits;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Claude Code encodes workspace paths as: lowercase drive letter, :\ → --, remaining \/ → -
// e.g. D:\Coding\Apps\null-ide → d--Coding-Apps-null-ide
function encodeProjectPath(workspacePath) {
    let p = workspacePath;
    p = p.replace(/^([A-Za-z]):[\\\/]/, (_, d) => d.toLowerCase() + '--');
    p = p.replace(/[\\\/]/g, '-');
    return p;
}
// Both `D--Coding-...` and `d--Coding-...` can exist for the same repo on Windows
// (see #99) — match the encoded directory name case-insensitively.
function findProjectDir(claudeProjectsDir, workspacePath) {
    const expected = encodeProjectPath(workspacePath).toLowerCase();
    let entries;
    try {
        entries = fs.readdirSync(claudeProjectsDir);
    }
    catch {
        return null;
    }
    const match = entries.find(e => e.toLowerCase() === expected);
    return match ? path.join(claudeProjectsDir, match) : null;
}
// Several parallel sessions can write to the same project dir — follow only
// the most recently written transcript.
function pickNewestTranscript(projectDir) {
    let entries;
    try {
        entries = fs.readdirSync(projectDir);
    }
    catch {
        return null;
    }
    let newest = null;
    for (const entry of entries) {
        if (!entry.endsWith('.jsonl'))
            continue;
        const full = path.join(projectDir, entry);
        let mtimeMs;
        try {
            mtimeMs = fs.statSync(full).mtimeMs;
        }
        catch {
            continue;
        }
        if (!newest || mtimeMs > newest.mtimeMs)
            newest = { file: full, mtimeMs };
    }
    return newest?.file ?? null;
}
function isPathInWorkspace(filePath, workspaceRoot) {
    const rel = path.relative(workspaceRoot, filePath);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
// Splits complete newline-terminated lines off the front of `text`, parsing
// each as JSON. Any trailing partial line (not yet newline-terminated) is
// left unconsumed so the caller can prepend it to the next read.
function parseAppendedLines(text) {
    const lastNewline = text.lastIndexOf('\n');
    if (lastNewline === -1)
        return { lines: [], consumedLength: 0 };
    const complete = text.slice(0, lastNewline);
    const lines = [];
    for (const raw of complete.split('\n')) {
        const trimmed = raw.trim();
        if (!trimmed)
            continue;
        try {
            lines.push(JSON.parse(trimmed));
        }
        catch {
            // Undocumented/evolving transcript format — skip lines we can't parse.
        }
    }
    return { lines, consumedLength: lastNewline + 1 };
}
// Walks a unified-diff hunk's `lines` (each prefixed ' '/'+'/'-', from the
// `diff` package's structuredPatch) to classify which new-file line numbers
// were added and what text was removed, so callers can render both.
function classifyHunkLines(newStart, lines) {
    const addedLines = [];
    const removedLines = [];
    if (!Array.isArray(lines))
        return { addedLines, removedLines };
    let lineNum = newStart;
    for (const raw of lines) {
        if (typeof raw !== 'string' || raw.length === 0)
            continue;
        const marker = raw[0];
        if (marker === '+') {
            addedLines.push(lineNum);
            lineNum++;
        }
        else if (marker === '-') {
            removedLines.push({ beforeLine: lineNum, text: raw.slice(1) });
        }
        else {
            lineNum++;
        }
    }
    return { addedLines, removedLines };
}
// Pulls exact post-edit line ranges out of a transcript `user` line's
// toolUseResult (the result of an Edit/Write tool_use). Parses defensively
// since the transcript format is undocumented and unrelated line shapes
// (e.g. Bash results) don't have this structure.
function extractEdits(line) {
    if (!line || typeof line !== 'object')
        return [];
    const toolUseResult = line['toolUseResult'];
    if (!toolUseResult || typeof toolUseResult !== 'object')
        return [];
    const filePath = toolUseResult['filePath'];
    const structuredPatch = toolUseResult['structuredPatch'];
    if (typeof filePath !== 'string' || !Array.isArray(structuredPatch))
        return [];
    const edits = [];
    for (const entry of structuredPatch) {
        const newStart = entry?.newStart;
        const newLines = entry?.newLines;
        if (typeof newStart === 'number' && typeof newLines === 'number') {
            edits.push({ filePath, newStart, newLines, ...classifyHunkLines(newStart, entry?.lines) });
        }
    }
    return edits;
}
//# sourceMappingURL=followAlong.js.map