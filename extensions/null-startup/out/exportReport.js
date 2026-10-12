'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportToJson = reportToJson;
exports.reportToMarkdown = reportToMarkdown;
const format_1 = require("./format");
const cell = (s) => s.replace(/\|/g, '\\|');
function table(head, rows, numericFrom = 1) {
    return [
        `| ${head.join(' | ')} |`,
        `| ${head.map((_, i) => (i >= numericFrom ? '---:' : '---')).join(' | ')} |`,
        ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
    ];
}
/** The JSON export is the stored report itself: it is already sanitized when built. */
function reportToJson(r) {
    return JSON.stringify(r, null, 2);
}
function reportToMarkdown(r, slowMs) {
    const phases = r.phases.filter((p) => p.impactMs !== undefined).sort((a, b) => (b.impactMs ?? 0) - (a.impactMs ?? 0)).slice(0, 5);
    const exts = [...r.extensions].sort((a, b) => (b.totalMs ?? -1) - (a.totalMs ?? -1)).slice(0, 10);
    return [
        '# Null IDE startup report',
        '',
        `- Launch: ${(0, format_1.stamp)(r.takenAt)} · app ${r.appVersion || 'n/a'}${r.initialStartup ? '' : ' · additional window'}${r.partial ? ' · partial data' : ''}`,
        `- Startup (workspace restored): **${(0, format_1.fmtMs)(r.headlineMs)}**`,
        '',
        '## Milestones',
        '',
        ...table(['Milestone', 'Since launch'], r.milestones.map((m) => [m.label, (0, format_1.fmtMs)(m.atMs)])),
        '',
        '## Slowest phases (wall-clock impact)',
        '',
        ...table(['Phase', 'Process', 'Duration', 'Impact'], phases.map((p) => [p.label, p.process, (0, format_1.fmtMs)(p.durationMs), (0, format_1.fmtMs)(p.impactMs)]), 2),
        '',
        `## Slowest extension activations (flagged at ${slowMs} ms)`,
        '',
        ...table(['Extension', 'Event', 'When', 'Total', 'Flag'], exts.map((e) => [e.id, e.activationEvent || 'n/a', e.deferred ? 'deferred' : 'startup', (0, format_1.fmtMs)(e.totalMs), e.totalMs !== undefined && e.totalMs >= slowMs ? 'slow' : '']), 3),
        '',
    ].join('\n');
}
//# sourceMappingURL=exportReport.js.map