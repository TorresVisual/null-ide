'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.choiceRange = choiceRange;
exports.parseDay = parseDay;
exports.customRange = customRange;
exports.trackedDataReport = trackedDataReport;
const stats_1 = require("./stats");
function choiceRange(choice, now) {
    if (choice === 'today')
        return (0, stats_1.dayRange)(now);
    if (choice === 'last7')
        return (0, stats_1.lastDaysRange)(now, 7);
    return (0, stats_1.monthRange)(now);
}
/** Local midnight of a real `YYYY-MM-DD` date, otherwise undefined. */
function parseDay(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!m)
        return undefined;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(y, mo - 1, d);
    return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date.getTime() : undefined;
}
/** `to` is an inclusive day. */
function customRange(fromText, toText) {
    const from = parseDay(fromText);
    const toDay = parseDay(toText);
    if (from === undefined || toDay === undefined || toDay < from)
        return undefined;
    return { from, to: (0, stats_1.nextPeriodStart)(toDay, 'day') };
}
function trackedDataReport(info) {
    const totals = info.months.length
        ? info.months.map((m) => `  ${m.day.slice(0, 7)}  ${(0, stats_1.formatDuration)(m.ms)}`).join('\n')
        : '  (no data yet)';
    return [
        'Null Activity — tracked data',
        '',
        'Recorded for each stretch of activity:',
        '  start and end time, project (git remote URL, or folder path when there is no remote,',
        '  plus the folder name), language, file (path relative to the workspace), git branch,',
        '  lines added and removed.',
        '',
        'Never recorded: file contents, diffs, or source text.',
        'Nothing leaves this machine unless you publish badges (only total time, daily average and top language, to a secret GitHub Gist)',
        'or turn on activity sync ("Null: Choose What to Sync"), which uploads all of the above to a secret Gist, encrypted with your sync passphrase.',
        '',
        `Storage: ${info.storageDir}`,
        `Tracking: ${info.enabled ? 'on' : 'off'} (setting null-activity.enabled)`,
        '',
        'Totals by month:',
        totals,
        '',
        'Delete data with "Null Activity: Delete Tracked Data for a Range…" or "Null Activity: Delete All Tracked Data…".',
        '',
    ].join('\n');
}
//# sourceMappingURL=privacy.js.map