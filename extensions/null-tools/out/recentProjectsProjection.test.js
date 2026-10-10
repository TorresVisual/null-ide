"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_vm_1 = __importDefault(require("node:vm"));
const sandbox = node_vm_1.default.createContext({});
node_vm_1.default.runInContext((0, node_fs_1.readFileSync)(node_path_1.default.join(__dirname, '..', 'lib', 'recent-projects.js'), 'utf8'), sandbox);
const projection = sandbox;
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const projects = [
    { path: 'D:\\work\\alpha', label: 'Alpha', timestamp: 1, pinned: false, available: true, isWorkspaceFile: false, gitStatus: null },
    { path: 'D:\\work\\beta', label: 'Beta', timestamp: 3, pinned: true, available: true, isWorkspaceFile: false, gitStatus: null },
    { path: 'C:\\other\\gamma', label: 'Gamma', timestamp: 2, pinned: false, available: true, isWorkspaceFile: false, gitStatus: null },
];
(0, node_test_1.default)('projectSections matches paths case-insensitively before grouping', () => {
    strict_1.default.deepEqual(Array.from(projection.projectSections(projects, 'D:/WORK', 'location'), section => section.title), ['Pinned', 'D:\\work']);
});
(0, node_test_1.default)('projectSections sorts pinned first then by the requested property', () => {
    strict_1.default.deepEqual(Array.from(projection.projectSections(projects, '', 'name')[1].projects, project => project.label), ['Alpha', 'Gamma']);
    strict_1.default.deepEqual(Array.from(projection.projectSections(projects, '', 'location'), section => section.title), ['Pinned', 'C:\\other', 'D:\\work']);
});
(0, node_test_1.default)('projectSections does not create empty sections after filtering', () => {
    strict_1.default.deepEqual(Array.from(projection.projectSections(projects, 'gamma', 'lastOpened', NOW), section => section.title), ['Earlier']);
});
(0, node_test_1.default)('projectSections groups last-opened projects by recency in order', () => {
    const hour = 60 * 60_000;
    const day = 24 * hour;
    const startOfToday = new Date(NOW).setHours(0, 0, 0, 0);
    const at = (label, timestamp) => ({ path: `D:\\${label}`, label, timestamp, pinned: false, available: true, isWorkspaceFile: false, gitStatus: null });
    const sections = projection.projectSections([at('old', NOW - 30 * day), at('week', startOfToday - 3 * day), at('yday', startOfToday - hour), at('now', NOW)], '', 'lastOpened', NOW);
    strict_1.default.deepEqual(Array.from(sections, section => section.title), ['Today', 'Yesterday', 'This week', 'Earlier']);
});
(0, node_test_1.default)('relativeProjectTime produces concise deterministic labels', () => {
    strict_1.default.equal(projection.relativeProjectTime(NOW - 60_000, NOW), '1 minute ago');
    strict_1.default.equal(projection.relativeProjectTime(NOW - 2 * 60 * 60_000, NOW), '2 hours ago');
});
(0, node_test_1.default)('shortProjectTime and formatDuration stay compact', () => {
    strict_1.default.equal(projection.shortProjectTime(NOW - 5 * 60_000, NOW), '5m');
    strict_1.default.equal(projection.shortProjectTime(NOW - 3 * 60 * 60_000, NOW), '3h');
    strict_1.default.equal(projection.shortProjectTime(NOW - 3 * 24 * 60 * 60_000, NOW), '3d');
    strict_1.default.equal(projection.shortProjectTime(NOW - 21 * 24 * 60 * 60_000, NOW), '3w');
    strict_1.default.equal(projection.formatDuration(45 * 60_000), '45m');
    strict_1.default.equal(projection.formatDuration((3 * 60 + 5) * 60_000), '3h 05m');
});
//# sourceMappingURL=recentProjectsProjection.test.js.map