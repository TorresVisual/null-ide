'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBadges = buildBadges;
const stats_1 = require("./stats");
/** Total time, average per active day, and most-used language — all-time. */
function buildBadges(api) {
    const days = api.getDailyStats(stats_1.ALL_TIME);
    const total = days.reduce((sum, d) => sum + d.ms, 0);
    const average = days.length ? total / days.length : 0;
    const top = api.getLanguageStats(stats_1.ALL_TIME).find((l) => l.language !== '');
    return [
        { file: 'null-activity-total.svg', label: 'coding time', value: (0, stats_1.formatDuration)(total), color: '#007ec6' },
        { file: 'null-activity-daily-average.svg', label: 'daily average', value: (0, stats_1.formatDuration)(average), color: '#4c1' },
        { file: 'null-activity-top-language.svg', label: 'top language', value: top?.language ?? 'none', color: '#fe7d37' },
    ];
}
//# sourceMappingURL=badgeModel.js.map