"use strict";
// Output summarizers for build, test, smoke and compdb. Pure: they read a finished log and decide.
// `ok` needs a positive signal in the log; `failed` is proven; anything else is `unknown` and never green.
// Patterns come from fixtures captured on UE 5.8 (fixtures/logs), not from documentation.
Object.defineProperty(exports, "__esModule", { value: true });
exports.unknown = unknown;
exports.summarizeBuild = summarizeBuild;
exports.summarizeTest = summarizeTest;
exports.summarizeSmoke = summarizeSmoke;
exports.summarizeCompdb = summarizeCompdb;
exports.summarizeLog = summarizeLog;
const MAX_ERRORS = 30;
const MAX_TESTS = 20;
const TAIL = 40;
const logLines = (log) => log.split(/\r?\n/);
// Caps a list and says where the rest is.
function capped(items, max, logPath) {
    if (items.length <= max)
        return items;
    return [...items.slice(0, max), `… ${items.length - max} more, see ${logPath ?? 'the log'}`];
}
// Duplicates collapse with a count. UAT builds the editor and game targets, so most errors appear twice.
function dedupe(items) {
    const counts = new Map();
    for (const i of items)
        counts.set(i, (counts.get(i) ?? 0) + 1);
    return [...counts].map(([text, n]) => (n > 1 ? `${text} (x${n})` : text));
}
function unknown(log, why) {
    const tail = logLines(log).filter((l) => l.trim() !== '').slice(-TAIL);
    return { verdict: 'unknown', lines: [`could not summarize (${why}); last ${tail.length} lines:`, ...tail] };
}
// `file(line,col): error C2065: msg`, `error LNK2019: msg`, clang `file:line:col: error: msg`, UAT `ERROR: msg`, `LogCook: Error: msg`.
const BUILD_ERROR = [
    /^(.+\(\d+(?:,\d+)?\)): (?:fatal )?error ([A-Z]+\d+): (.*)$/,
    /^(?:\S.*?): (?:fatal )?error (LNK\d+): (.*)$/,
    /^(.+?:\d+:\d+): (?:fatal )?error: (.*)$/,
    /^ERROR: (.*)$/,
    /^LogCook: Error: (.*)$/,
];
function summarizeBuild(log, logPath) {
    const lines = logLines(log);
    const errors = dedupe(lines.filter((l) => BUILD_ERROR.some((re) => re.test(l))).map((l) => l.trim()));
    const exit = [...lines].reverse().map((l) => /^AutomationTool exiting with ExitCode=(-?\d+)/.exec(l)).find(Boolean);
    const exitCode = exit ? Number(exit[1]) : undefined;
    const successful = lines.includes('BUILD SUCCESSFUL');
    const failedMarker = lines.includes('BUILD FAILED');
    if (errors.length > 0 || failedMarker || (exitCode !== undefined && exitCode !== 0)) {
        const head = `build failed: ${errors.length} error${errors.length === 1 ? '' : 's'}${exitCode !== undefined ? `, AutomationTool exit ${exitCode}` : ''}`;
        return { verdict: 'failed', lines: [head, ...capped(errors, MAX_ERRORS, logPath)] };
    }
    if (successful && exitCode === 0)
        return { verdict: 'ok', lines: ['build succeeded'] };
    return unknown(log, 'no BUILD SUCCESSFUL and no errors');
}
const TEST_DONE = /Test Completed\. Result=\{(\w+)\} Name=\{.*?\} Path=\{(.+?)\}\s*$/;
const TEST_START = /Test Started\. Name=\{.*?\} Path=\{(.+?)\}\s*$/;
const EVENT = /LogAutomationController: (Error|Warning): (.*)$/;
const NO_MATCH = /No automation tests matched '(.*)'/;
function summarizeTest(log, logPath) {
    const lines = logLines(log);
    const started = new Set();
    const results = new Map();
    const events = new Map(); // test path -> its error and warning lines
    let current;
    let noMatch;
    let fatal;
    for (const l of lines) {
        const begin = /LogAutomationController: BeginEvents: (.+?)\s*$/.exec(l);
        if (begin) {
            current = begin[1];
            continue;
        }
        if (/LogAutomationController: EndEvents: /.test(l)) {
            current = undefined;
            continue;
        }
        const ev = EVENT.exec(l);
        if (ev && current && !TEST_DONE.test(l)) {
            const list = events.get(current) ?? [];
            list.push(`${ev[1].toLowerCase()}: ${ev[2].trim()}`);
            events.set(current, list);
            continue;
        }
        const s = TEST_START.exec(l);
        if (s)
            started.add(s[1]);
        const d = TEST_DONE.exec(l);
        if (d)
            results.set(d[2], d[1]);
        const m = NO_MATCH.exec(l);
        if (m)
            noMatch = m[1];
        if (!fatal && /LogWindows: Error: appError called: /.test(l))
            fatal = l.replace(/^.*appError called: /, '').trim();
    }
    const failed = [...results].filter(([, r]) => r !== 'Success' && r !== 'Skipped');
    const passed = [...results].filter(([, r]) => r === 'Success').length;
    const hung = [...started].filter((p) => !results.has(p));
    const counts = `${passed} passed, ${failed.length} failed${hung.length ? `, ${hung.length} did not finish` : ''}`;
    if (noMatch !== undefined && results.size === 0) {
        return { verdict: 'failed', lines: [`test failed: no tests matched '${noMatch}' (wrong --filter?)`] };
    }
    if (failed.length > 0 || hung.length > 0 || fatal) {
        const detail = failed.flatMap(([p, r]) => [`FAIL ${p} (${r})`, ...(events.get(p) ?? []).map((e) => `  ${e}`)]);
        const rest = hung.map((p) => `HUNG ${p} (started, never completed)`);
        const out = capped([...detail, ...rest], MAX_TESTS * 3, logPath);
        return { verdict: 'failed', lines: [`test failed: ${counts}${fatal ? `; fatal: ${fatal}` : ''}`, ...out] };
    }
    if (results.size > 0)
        return { verdict: 'ok', lines: [`test passed: ${counts}`] };
    return unknown(log, 'no test results');
}
function summarizeSmoke(log) {
    const lines = logLines(log);
    const i = lines.findIndex((l) => /LogWindows: Error: appError called: /.test(l));
    if (i >= 0) {
        const first = lines[i].replace(/^.*appError called: /, '').trim();
        const detail = lines.slice(i + 1).find((l) => l.trim() !== '' && !l.includes('LogWindows: Error'));
        return { verdict: 'failed', lines: ['smoke failed: fatal error at startup', [first, detail?.trim()].filter(Boolean).join(' ')] };
    }
    const fatal = lines.find((l) => /LogWindows: Error: Fatal error/.test(l));
    if (fatal)
        return { verdict: 'failed', lines: ['smoke failed: fatal error at startup', fatal.replace(/^.*Error: /, '').trim()] };
    // A clean game shutdown logs PreExit; a process that died earlier does not.
    if (lines.some((l) => /LogInit: Display: PreExit Game\./.test(l)))
        return { verdict: 'ok', lines: ['smoke passed'] };
    return unknown(log, 'no clean shutdown in the log');
}
// UBT prints the file it wrote. `-OutputDir` decides where; clangd finds it by walking up from the sources.
function summarizeCompdb(log) {
    const lines = logLines(log);
    const written = lines.map((l) => /^ClangDatabase written to (.+?)\s*$/.exec(l)).find(Boolean);
    const result = lines.map((l) => /^Result: (.*?)\s*$/.exec(l)).find(Boolean);
    if (written && result?.[1] === 'Succeeded')
        return { verdict: 'ok', lines: [`compile database: ${written[1]}`] };
    if (result && result[1] !== 'Succeeded') {
        const reason = lines.find((l) => /Couldn't find|error|Unable|not found/i.test(l) && !/^Result:/.test(l));
        return { verdict: 'failed', lines: [`compdb failed: ${result[1]}${reason ? ` — ${reason.trim()}` : ''}`] };
    }
    return unknown(log, 'no ClangDatabase line');
}
function summarizeLog(cmd, log, logPath) {
    switch (cmd) {
        case 'build': return summarizeBuild(log, logPath);
        case 'test': return summarizeTest(log, logPath);
        case 'smoke': return summarizeSmoke(log);
        case 'compdb': return summarizeCompdb(log);
    }
}
//# sourceMappingURL=summary.js.map