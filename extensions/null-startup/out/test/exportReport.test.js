'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const buildReport_1 = require("../buildReport");
const exportReport_1 = require("../exportReport");
const snap = {
    schemaVersion: 1, takenAt: 5000, appVersion: '1.2.3', initialStartup: true, metrics: {}, contributions: [],
    marks: [
        { source: 'main', name: 'code/didStartMain', startTime: 1000 },
        { source: 'renderer', name: 'code/didRestoreEditors', startTime: 2500 },
    ],
    extensions: [
        { id: 'p.slow', activationEvent: 'workspaceContains:C:\\Users\\me\\secret-project\\x', reason: 'p.slow', eager: true, startMs: 1100, endMs: 1500, loadMs: 100, callMs: 100, resolveMs: 100 },
        { id: 'p.quick', activationEvent: 'onLanguage:rust', reason: 'p.quick', eager: false, loadMs: 1, callMs: 1, resolveMs: 1 },
    ],
};
const report = (0, buildReport_1.buildReport)(snap, { id: 'r', windowId: 'w' });
(0, node_test_1.test)('markdown names the headline, flags slow extensions and renders missing data as n/a', () => {
    const md = (0, exportReport_1.reportToMarkdown)(report, 100);
    node_assert_1.default.match(md, /Startup \(workspace restored\): \*\*1\.50 s\*\*/);
    node_assert_1.default.match(md, /\| p\.slow \|.*slow/);
    node_assert_1.default.doesNotMatch(md, /\| p\.quick \|.*slow/);
    node_assert_1.default.match(md, /n\/a/);
});
(0, node_test_1.test)('no export format carries a path or workspace name', () => {
    for (const text of [(0, exportReport_1.reportToMarkdown)(report, 100), (0, exportReport_1.reportToJson)(report)]) {
        node_assert_1.default.doesNotMatch(text, /secret-project|Users|C:\\\\|C:\//);
    }
});
(0, node_test_1.test)('json round-trips to the same report', () => {
    node_assert_1.default.deepStrictEqual(JSON.parse((0, exportReport_1.reportToJson)(report)), JSON.parse(JSON.stringify(report)));
});
(0, node_test_1.test)('pipes in cells cannot break the table', () => {
    const r = { ...report, extensions: [{ ...report.extensions[0], id: 'a|b' }] };
    node_assert_1.default.match((0, exportReport_1.reportToMarkdown)(r, 100), /a\\\|b/);
});
//# sourceMappingURL=exportReport.test.js.map