'use strict';
function searchable(value) {
    return value.replace(/[\\/]+/g, '/').toLowerCase();
}
function projectDirectory(value) {
    const lastSeparator = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'));
    return lastSeparator >= 0 ? value.slice(0, lastSeparator) : value;
}
function compareProjects(sort) {
    if (sort === 'name')
        return (left, right) => left.label.localeCompare(right.label) || left.timestamp - right.timestamp;
    if (sort === 'location')
        return (left, right) => projectDirectory(left.path).localeCompare(projectDirectory(right.path)) || left.label.localeCompare(right.label);
    return (left, right) => right.timestamp - left.timestamp;
}
function recencyTitle(timestamp, now) {
    const startOfToday = new Date(now).setHours(0, 0, 0, 0);
    const day = 86400000;
    if (timestamp >= startOfToday)
        return 'Today';
    if (timestamp >= startOfToday - day)
        return 'Yesterday';
    if (timestamp >= startOfToday - 6 * day)
        return 'This week';
    return 'Earlier';
}
function projectSections(projects, query, sort, now = Date.now()) {
    var _a;
    const needle = searchable(query.trim());
    const filtered = projects.filter(project => !needle || searchable(project.label).includes(needle) || searchable(project.path).includes(needle));
    const ordered = [...filtered].sort(compareProjects(sort));
    const pinned = ordered.filter(project => project.pinned);
    const rest = ordered.filter(project => !project.pinned);
    const groups = new Map();
    const kind = sort === 'location' ? 'directory' : 'recent';
    for (const project of rest) {
        const title = sort === 'location' ? projectDirectory(project.path) : sort === 'name' ? 'Projects' : recencyTitle(project.timestamp, now);
        const group = (_a = groups.get(title)) !== null && _a !== void 0 ? _a : [];
        group.push(project);
        groups.set(title, group);
    }
    return [
        ...(pinned.length ? [{ kind: 'pinned', title: 'Pinned', projects: pinned }] : []),
        ...[...groups].map(([title, groupedProjects]) => ({ kind: kind, title, projects: groupedProjects })),
    ];
}
function relativeProjectTime(timestamp, now = Date.now()) {
    const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
    if (minutes < 1)
        return 'just now';
    if (minutes < 60)
        return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
}
/** Row-sized age: "now", "5m", "3h", "2d", "6w". */
function shortProjectTime(timestamp, now = Date.now()) {
    const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
    if (minutes < 1)
        return 'now';
    if (minutes < 60)
        return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours}h`;
    const days = Math.floor(hours / 24);
    return days < 14 ? `${days}d` : `${Math.floor(days / 7)}w`;
}
/** "3h 12m", "45m", "0m". */
function formatDuration(ms) {
    const minutes = Math.max(0, Math.floor(ms / 60000));
    return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}
