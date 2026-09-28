'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhyIndex = void 0;
exports.excerpt = excerpt;
exports.extractAddedLines = extractAddedLines;
// Builds an in-memory "why is this here" index from a Claude Code transcript:
// for each line an Edit/Write tool added, records the prompt that led to it
// and whatever Claude said right before making the edit. See issue #100.
const MAX_WALK_STEPS = 500;
const MIN_MATCH_LENGTH = 4;
function isTranscriptLine(line) {
    return !!line && typeof line === 'object';
}
// A `type: "user"` line is a real user message only when its content isn't
// a tool_result round-trip (those are also `type: "user"` in the transcript).
function isRealUserPrompt(line) {
    if (line.type !== 'user')
        return false;
    const content = line.message?.content;
    if (typeof content === 'string')
        return true;
    if (Array.isArray(content))
        return content.length > 0 && content.every(b => b?.type !== 'tool_result');
    return false;
}
function userPromptText(line) {
    const content = line.message?.content;
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content)) {
        const text = content.find(b => b?.type === 'text')?.text;
        return typeof text === 'string' ? text : null;
    }
    return null;
}
function assistantTextBefore(line) {
    if (line.type !== 'assistant')
        return null;
    const content = line.message?.content;
    if (!Array.isArray(content))
        return null;
    const texts = content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text);
    return texts.length ? texts.join('\n\n') : null;
}
function excerpt(text, maxLength) {
    const clean = text.trim().replace(/\s+/g, ' ');
    return clean.length > maxLength ? clean.slice(0, maxLength) + '…' : clean;
}
// Like followAlong.ts's extractEdits, but keeps the added lines' text (needed
// to re-match lines by content once numbers drift) instead of just numbers.
function extractAddedLines(line) {
    if (!isTranscriptLine(line))
        return [];
    const toolUseResult = line.toolUseResult;
    const filePath = toolUseResult?.filePath;
    const structuredPatch = toolUseResult?.structuredPatch;
    if (typeof filePath !== 'string' || !Array.isArray(structuredPatch))
        return [];
    const addedLines = [];
    for (const hunk of structuredPatch) {
        let lineNumber = hunk?.newStart;
        if (typeof lineNumber !== 'number' || !Array.isArray(hunk.lines))
            continue;
        for (const raw of hunk.lines) {
            if (typeof raw !== 'string' || raw.length === 0)
                continue;
            const marker = raw[0];
            if (marker === '+') {
                addedLines.push({ lineNumber, text: raw.slice(1) });
                lineNumber++;
            }
            else if (marker !== '-') {
                lineNumber++;
            }
        }
    }
    return addedLines.length ? [{ filePath, addedLines }] : [];
}
// Accumulates transcript lines for one session and answers "why is this line
// here" lookups. Only ever fed lines from the point watching started (see
// followAlong.ts's same backlog-skipping choice) — an edit whose context
// chain reaches further back than that will just get no annotation.
class WhyIndex {
    sessionId;
    uuidMap = new Map();
    sessionTitle = null;
    byFile = new Map();
    constructor(sessionId) {
        this.sessionId = sessionId;
    }
    ingest(lines) {
        for (const raw of lines) {
            if (!isTranscriptLine(raw))
                continue;
            if (raw.uuid)
                this.uuidMap.set(raw.uuid, raw);
            if (raw.type === 'ai-title' && typeof raw.aiTitle === 'string')
                this.sessionTitle = raw.aiTitle;
        }
        for (const raw of lines) {
            if (isTranscriptLine(raw))
                this.indexEdits(raw);
        }
    }
    findAnnotation(filePath, lineNumber, lineText) {
        const trimmed = lineText.trim();
        if (trimmed.length < MIN_MATCH_LENGTH)
            return null;
        const entries = this.byFile.get(filePath);
        if (!entries)
            return null;
        let best = null;
        let bestDistance = Infinity;
        for (const entry of entries) {
            if (entry.lineText.trim() !== trimmed)
                continue;
            const distance = Math.abs(entry.lineNumber - lineNumber);
            if (distance < bestDistance) {
                best = entry;
                bestDistance = distance;
            }
        }
        if (!best)
            return null;
        // sessionTitle can arrive after the edit was indexed — read it live.
        return { ...best, annotation: { ...best.annotation, sessionTitle: this.sessionTitle } };
    }
    indexEdits(line) {
        for (const edit of extractAddedLines(line)) {
            const context = this.resolveContext(line);
            if (!context?.prompt)
                continue;
            const annotation = {
                prompt: context.prompt,
                claudeSaid: context.claudeSaid,
                sessionId: this.sessionId,
                sessionTitle: this.sessionTitle,
                timestamp: context.timestamp,
            };
            const entries = this.byFile.get(edit.filePath) ?? [];
            for (const added of edit.addedLines) {
                entries.push({ filePath: edit.filePath, lineText: added.text, lineNumber: added.lineNumber, annotation });
            }
            this.byFile.set(edit.filePath, entries);
        }
    }
    // Walks parentUuid back from the tool-result line to the assistant message
    // that made the edit, then further back to the user prompt that started
    // this turn, collecting the nearest preceding assistant text along the way.
    resolveContext(toolResultLine) {
        let cur = toolResultLine.parentUuid ? this.uuidMap.get(toolResultLine.parentUuid) : undefined;
        if (!cur)
            return null;
        let claudeSaid = null;
        let prompt = null;
        let steps = 0;
        while (cur && steps++ < MAX_WALK_STEPS) {
            if (isRealUserPrompt(cur)) {
                prompt = userPromptText(cur);
                break;
            }
            if (!claudeSaid)
                claudeSaid = assistantTextBefore(cur);
            cur = cur.parentUuid ? this.uuidMap.get(cur.parentUuid) : undefined;
        }
        return { prompt, claudeSaid, timestamp: toolResultLine.timestamp ?? null };
    }
}
exports.WhyIndex = WhyIndex;
//# sourceMappingURL=whyIsThisHere.js.map