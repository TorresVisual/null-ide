"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const widgetSections_1 = require("./widgetSections");
const rank = (rows) => [...rows].sort((a, b) => a - b);
(0, node_test_1.default)('all repos ok: status ok, rows merged and ranked, capped', () => {
    const { section, kept } = (0, widgetSections_1.buildSection)([{ repo: 'a/b', rows: [5, 1] }, { repo: 'c/d', rows: [3] }], new Map(), rank, 2);
    node_assert_1.default.deepStrictEqual(section, { status: 'ok', failed: [], items: [1, 3] });
    node_assert_1.default.deepStrictEqual([...kept.keys()].sort(), ['a/b', 'c/d']);
});
(0, node_test_1.default)('partial failure: status stays ok, the failed repo keeps its last good rows and is listed', () => {
    const previous = new Map([['c/d', [9]]]);
    const { section, kept } = (0, widgetSections_1.buildSection)([{ repo: 'a/b', rows: [1] }, { repo: 'C/D', rows: null, reason: 'offline' }], previous, rank, 10);
    node_assert_1.default.deepStrictEqual(section, { status: 'ok', failed: [{ repo: 'C/D', reason: 'offline' }], items: [1, 9] });
    node_assert_1.default.deepStrictEqual(kept.get('c/d'), [9]);
});
(0, node_test_1.default)('every repo failed with the same reason: the section takes that reason and keeps all rows', () => {
    const previous = new Map([['a/b', [2]], ['c/d', [4]]]);
    const { section } = (0, widgetSections_1.buildSection)([{ repo: 'a/b', rows: null, reason: 'signed_out' }, { repo: 'c/d', rows: null, reason: 'signed_out' }], previous, rank, 10);
    node_assert_1.default.strictEqual(section.status, 'signed_out');
    node_assert_1.default.deepStrictEqual(section.items, [2, 4]);
    node_assert_1.default.strictEqual(section.failed.length, 2);
});
(0, node_test_1.default)('every repo failed for different reasons: status is error', () => {
    const { section } = (0, widgetSections_1.buildSection)([{ repo: 'a/b', rows: null, reason: 'offline' }, { repo: 'c/d', rows: null, reason: 'signed_out' }], new Map(), rank, 10);
    node_assert_1.default.strictEqual(section.status, 'error');
});
(0, node_test_1.default)('a repo that is no longer configured drops its remembered rows', () => {
    const { section, kept } = (0, widgetSections_1.buildSection)([{ repo: 'a/b', rows: [1] }], new Map([['gone/x', [7]]]), rank, 10);
    node_assert_1.default.deepStrictEqual(section.items, [1]);
    node_assert_1.default.ok(!kept.has('gone/x'));
});
(0, node_test_1.default)('no repos configured is an empty ok section, not an error', () => {
    node_assert_1.default.deepStrictEqual((0, widgetSections_1.buildSection)([], new Map(), rank, 10).section, { status: 'ok', failed: [], items: [] });
});
(0, node_test_1.default)('projects: pinned first, then newest, capped at 8, git status attached, ISO timestamps', () => {
    const e = (n, pinned = false) => ({ path: `D:\\p${n}`, label: `p${n}`, isWorkspaceFile: false, timestamp: Date.UTC(2026, 9, 21, n), pinned });
    const entries = [e(1), e(9), e(2, true), e(3), e(4), e(5), e(6), e(7), e(8)];
    const { items, status } = (0, widgetSections_1.buildProjects)(entries, new Map([['D:\\p2', { branch: 'main', dirty: true }], ['D:\\p9', null]]));
    node_assert_1.default.strictEqual(status, 'ok');
    node_assert_1.default.strictEqual(items.length, 8);
    node_assert_1.default.deepStrictEqual(items.slice(0, 3).map(p => p.name), ['p2', 'p9', 'p8']);
    node_assert_1.default.deepStrictEqual([items[0].branch, items[0].dirty, items[0].pinned, items[0].lastOpened], ['main', true, true, '2026-10-21T02:00:00.000Z']);
    node_assert_1.default.deepStrictEqual([items[1].branch, items[1].dirty], [null, false]); // git failed: no branch, not dirty
});
//# sourceMappingURL=widgetSections.test.js.map