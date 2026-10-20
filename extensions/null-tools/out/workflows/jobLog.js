'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.firstFailedStep = exports.GONE_NOTICE = exports.NOT_YET_NOTICE = exports.TRUNCATED_NOTICE = void 0;
exports.cleanLog = cleanLog;
exports.segmentLog = segmentLog;
exports.locateStep = locateStep;
exports.pathRefs = pathRefs;
exports.repoRelative = repoRelative;
exports.renderJobDoc = renderJobDoc;
const workflowsModel_1 = require("./workflowsModel");
exports.TRUNCATED_NOTICE = 'Log truncated (showing last 5 MB). Open on GitHub for the full log.';
exports.NOT_YET_NOTICE = 'Logs appear when the job finishes.';
exports.GONE_NOTICE = 'Logs are no longer available (GitHub keeps them 90 days) or you lack access.';
const TIMESTAMP = /^﻿?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;
// GitHub echoes `run:` scripts with colour escapes (ESC[36;1m … ESC[0m); a document would show them as control characters.
const ANSI = /\u001b\[[0-9;]*m/g;
/** Log lines for display: no timestamps (step rows show durations), no colour escapes, `##[group]x` as `▶ x`, `##[endgroup]` gone. */
function cleanLog(raw) {
    const out = [];
    for (const line of raw.split(/\r?\n/)) {
        const text = line.replace(TIMESTAMP, '').replace(/^﻿/, '').replace(ANSI, '');
        if (text.startsWith('##[endgroup]'))
            continue;
        out.push(text.startsWith('##[group]') ? `▶ ${text.slice('##[group]'.length)}` : text);
    }
    while (out.length > 0 && out[out.length - 1] === '')
        out.pop();
    return out;
}
/**
 * Where each step's text begins: the first step ("Set up job") starts the log; every `run:`/`uses:` step opens a
 * `##[group]Run …` group, post steps open with "Post job cleanup." and the last step with "Cleaning up orphan processes".
 * A user's own `::group::` does not match, so it stays inside its step. (A user group literally named "Run …" would
 * add a segment; `locateStep` then sees a count mismatch and falls back to the full log.)
 */
const STEP_MARKER = /^(▶ Run |Post job cleanup\.$|Cleaning up orphan processes$)/;
function segmentLog(lines) {
    const starts = [0];
    lines.forEach((l, i) => { if (i > 0 && STEP_MARKER.test(l))
        starts.push(i); });
    return starts.map((start, i) => ({ start, end: starts[i + 1] ?? lines.length }));
}
/** A step that has written, or is writing, log text: not skipped, and already started. */
const wroteLog = (s) => s.conclusion !== 'skipped' && (s.status === 'completed' || s.status === 'in_progress');
/**
 * The lines of one step. Exact only when the log splits into as many segments as there are steps that wrote anything
 * (a skipped or not-yet-started step writes nothing); otherwise the whole log from the nearest heading, so a step never
 * ends in an error.
 */
function locateStep(lines, steps, stepNumber) {
    const logged = steps.filter(wroteLog);
    const segments = segmentLog(lines);
    const index = logged.findIndex(s => s.number === stepNumber);
    if (index >= 0 && segments.length === logged.length)
        return { ...segments[index], exact: true };
    const nearest = segments[Math.min(Math.max(index, 0), segments.length - 1)];
    return { start: nearest.start, end: lines.length, exact: false };
}
const firstFailedStep = (job) => job.steps.find(workflowsModel_1.isFailed);
exports.firstFailedStep = firstFailedStep;
// The lookbehind keeps urls (`https://h/a.js:3`) and windows paths (`\x.ts:3`) from yielding a bogus relative path.
const BEFORE = String.raw `(?<![\\\w./@:-])`;
const FILE = String.raw `([\w./@-]+\.\w+)`;
const COLON = new RegExp(`${BEFORE}${FILE}:(\\d+)(?::(\\d+))?`, 'g');
const PAREN = new RegExp(`${BEFORE}${FILE}\\((\\d+)(?:,(\\d+))?\\)`, 'g');
function pathRefs(text) {
    const out = [];
    for (const re of [COLON, PAREN]) {
        re.lastIndex = 0;
        for (let m = re.exec(text); m; m = re.exec(text)) {
            out.push({ path: m[1], line: Number(m[2]), col: m[3] ? Number(m[3]) : null, start: m.index, end: m.index + m[0].length });
        }
    }
    return out.sort((a, b) => a.start - b.start);
}
const RUNNER_WORKSPACE = /^\/home\/runner\/work\/[^/]+\/[^/]+\//;
/** A path inside the repo (the Linux runner's workspace prefix removed), or null for anything that could leave it. */
function repoRelative(p) {
    const rel = p.replace(RUNNER_WORKSPACE, '').replace(/^\.\//, '');
    if (!rel || rel.startsWith('/') || rel.split('/').some(s => s === '' || s === '..'))
        return null;
    return rel;
}
// ── the document ────────────────────────────────────────────────────────────
const MARK = { success: '✓', failure: '✗', timed_out: '✗', startup_failure: '✗', cancelled: '⊘', skipped: '–', in_progress: '…' };
const mark = (s) => MARK[s.status === 'completed' ? s.conclusion ?? '' : s.status] ?? '·';
function stepSummary(job, now) {
    return [
        `${job.name} — ${job.status === 'completed' ? job.conclusion ?? 'completed' : job.status.replace('_', ' ')}`,
        ...job.steps.map(s => `  ${mark(s)} ${s.name} ${(0, workflowsModel_1.elapsed)(s.startedAt, s.completedAt, now)}`.trimEnd()),
    ];
}
/** The text of a `null-workflows:` document. Line 1 is the truncation notice when the front of the log was cut. */
function renderJobDoc(i) {
    let lines = i.log !== null ? cleanLog(i.log) : [];
    if (i.step !== null && lines.length > 0) {
        const at = locateStep(lines, i.job.steps, i.step);
        lines = lines.slice(at.start, at.end);
    }
    const live = (0, workflowsModel_1.isActive)(i.job);
    const out = [];
    if (i.truncated)
        out.push(exports.TRUNCATED_NOTICE);
    if (live) {
        out.push(...stepSummary(i.job, i.now), '');
        out.push(...(lines.length > 0 ? lines : [exports.NOT_YET_NOTICE]));
    }
    else if (lines.length > 0) {
        out.push(...lines);
    }
    else {
        out.push(i.gone ? exports.GONE_NOTICE : '(This job wrote no log.)');
    }
    return out.join('\n');
}
//# sourceMappingURL=jobLog.js.map