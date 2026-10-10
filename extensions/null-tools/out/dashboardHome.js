'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.homeUpdate = homeUpdate;
exports.todayMs = todayMs;
/** An update is "ready" once its download is verified and staged; until then the rail only reports it. */
function homeUpdate(available, staged) {
    if (!available?.latest)
        return undefined;
    return { version: available.latest, ready: staged?.version === available.latest && staged.verified };
}
/** Active coding time since local midnight; undefined when null-activity is not installed. */
function todayMs(activity, now = Date.now()) {
    if (!activity)
        return undefined;
    const from = new Date(now).setHours(0, 0, 0, 0);
    return activity.getDailyStats({ from, to: now + 1 }).reduce((sum, day) => sum + day.ms, 0);
}
//# sourceMappingURL=dashboardHome.js.map