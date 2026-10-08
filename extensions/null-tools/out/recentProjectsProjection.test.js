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
    strict_1.default.deepEqual(Array.from(projection.projectSections(projects, '', 'name')[1].projects, project => project.label), ['Alpha']);
    strict_1.default.deepEqual(Array.from(projection.projectSections(projects, '', 'location'), section => section.title), ['Pinned', 'C:\\other', 'D:\\work']);
});
(0, node_test_1.default)('projectSections does not create empty directory sections after filtering', () => {
    strict_1.default.deepEqual(Array.from(projection.projectSections(projects, 'gamma', 'lastOpened'), section => section.title), ['C:\\other']);
});
(0, node_test_1.default)('relativeProjectTime produces concise deterministic labels', () => {
    strict_1.default.equal(projection.relativeProjectTime(NOW - 60_000, NOW), '1 minute ago');
    strict_1.default.equal(projection.relativeProjectTime(NOW - 2 * 60 * 60_000, NOW), '2 hours ago');
});
//# sourceMappingURL=recentProjectsProjection.test.js.map