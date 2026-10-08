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
function projectSections(projects, query, sort) {
    var _a;
    const needle = searchable(query.trim());
    const filtered = projects.filter(project => !needle || searchable(project.label).includes(needle) || searchable(project.path).includes(needle));
    const ordered = [...filtered].sort(compareProjects(sort));
    const pinned = ordered.filter(project => project.pinned);
    const directories = new Map();
    for (const project of ordered.filter(project => !project.pinned)) {
        const directory = projectDirectory(project.path);
        const group = (_a = directories.get(directory)) !== null && _a !== void 0 ? _a : [];
        group.push(project);
        directories.set(directory, group);
    }
    return [
        ...(pinned.length ? [{ kind: 'pinned', title: 'Pinned', projects: pinned }] : []),
        ...[...directories].map(([title, groupedProjects]) => ({ kind: 'directory', title, projects: groupedProjects })),
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
