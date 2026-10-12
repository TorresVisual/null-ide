'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const buildReport_1 = require("../buildReport");
const mark = (source, name, startTime) => ({ source, name, startTime });
const ext = (over) => ({ activationEvent: '*', reason: over.id, eager: true, ...over });
function snapshot(over = {}) {
    return {
        schemaVersion: 1, takenAt: 9000, appVersion: '1.2.3', initialStartup: true, metrics: {}, contributions: [],
        marks: [
            mark('main', 'code/didStartMain', 1000),
            mark('main', 'code/willCreateCodeWindow', 1100),
            mark('main', 'code/didCreateCodeWindow', 1200),
            mark('renderer', 'code/willStartWorkbench', 1500),
            mark('renderer', 'code/didStartWorkbench', 2000),
            mark('renderer', 'code/willRestoreEditors', 2000),
            mark('renderer', 'code/didRestoreEditors', 2500),
        ],
        extensions: [
            ext({ id: 'p.fast', startMs: 1100, endMs: 1900, loadMs: 10, callMs: 20, resolveMs: 30, activationEvent: 'workspaceContains:C:\\Users\\me\\x' }),
            ext({ id: 'p.late', startMs: 2000, endMs: 3000, loadMs: 1, callMs: 2, resolveMs: 3 }),
            ext({ id: 'p.lazy', eager: false, activationEvent: 'onLanguage:rust' }),
        ],
        ...over,
    };
}
(0, node_test_1.test)('milestones are offsets from launch and the headline is workspaceRestored', () => {
    const r = (0, buildReport_1.buildReport)(snapshot(), { id: 'r1', windowId: 'w1' });
    const at = Object.fromEntries(r.milestones.map((m) => [m.id, m.atMs]));
    node_assert_1.default.deepStrictEqual(at, { windowCreated: 200, uiInteractive: 1000, workspaceRestored: 1500, extensionsSettled: 2000 });
    node_assert_1.default.strictEqual(r.headlineMs, 1500);
    node_assert_1.default.strictEqual(r.partial, false);
    node_assert_1.default.strictEqual(r.id, 'r1');
    node_assert_1.default.strictEqual(r.windowId, 'w1');
});
(0, node_test_1.test)('later windows start at willOpenNewWindow, falling back to timeOrigin', () => {
    const s = snapshot({ initialStartup: false, marks: [mark('renderer', 'code/willOpenNewWindow', 100), mark('renderer', 'code/didRestoreEditors', 400)] });
    node_assert_1.default.strictEqual((0, buildReport_1.buildReport)(s, { id: 'a', windowId: 'w' }).headlineMs, 300);
    const t = snapshot({ marks: [mark('renderer', 'code/timeOrigin', 50), mark('renderer', 'code/didRestoreEditors', 90)] });
    node_assert_1.default.strictEqual((0, buildReport_1.buildReport)(t, { id: 'a', windowId: 'w' }).headlineMs, 40);
});
(0, node_test_1.test)('phases have durations and wall-clock impact; missing marks give undefined, not errors', () => {
    const r = (0, buildReport_1.buildReport)(snapshot(), { id: 'r', windowId: 'w' });
    const byId = Object.fromEntries(r.phases.map((p) => [p.id, p]));
    node_assert_1.default.deepStrictEqual([byId['window-create'].startMs, byId['window-create'].endMs, byId['window-create'].durationMs], [100, 200, 100]);
    node_assert_1.default.strictEqual(byId['workbench'].durationMs, 500);
    node_assert_1.default.strictEqual(byId['editors'].durationMs, 500);
    node_assert_1.default.strictEqual(byId['workbench'].impactMs, 500);
    node_assert_1.default.strictEqual(byId['editors'].impactMs, 500);
    node_assert_1.default.strictEqual(byId['storage'].durationMs, undefined, 'no storage marks in this snapshot');
    node_assert_1.default.strictEqual(byId['storage'].impactMs, undefined);
});
(0, node_test_1.test)('extensions split into startup and deferred, with sanitized events and totals', () => {
    const r = (0, buildReport_1.buildReport)(snapshot(), { id: 'r', windowId: 'w' });
    const byId = Object.fromEntries(r.extensions.map((e) => [e.id, e]));
    node_assert_1.default.strictEqual(byId['p.fast'].deferred, false, 'ended (1900) before restored (2500)');
    node_assert_1.default.strictEqual(byId['p.fast'].totalMs, 60);
    node_assert_1.default.strictEqual(byId['p.fast'].activationEvent, 'workspaceContains');
    node_assert_1.default.deepStrictEqual([byId['p.fast'].startMs, byId['p.fast'].endMs], [100, 900]);
    node_assert_1.default.strictEqual(byId['p.late'].deferred, true, 'ended after restored');
    node_assert_1.default.strictEqual(byId['p.lazy'].deferred, true, 'no stamps and not eager');
    node_assert_1.default.strictEqual(byId['p.lazy'].totalMs, undefined);
});
(0, node_test_1.test)('overlapping activations are not double-counted in impact', () => {
    const s = snapshot({ extensions: [ext({ id: 'a', startMs: 1100, endMs: 1600 }), ext({ id: 'b', startMs: 1100, endMs: 1600 })] });
    const r = (0, buildReport_1.buildReport)(s, { id: 'r', windowId: 'w' });
    node_assert_1.default.strictEqual(r.extensions.reduce((sum, e) => sum + (e.impactMs ?? 0), 0), 500);
});
(0, node_test_1.test)('a snapshot with no marks is partial and every offset is undefined', () => {
    const r = (0, buildReport_1.buildReport)(snapshot({ marks: [], extensions: [ext({ id: 'a', startMs: 5, endMs: 9 })] }), { id: 'r', windowId: 'w' });
    node_assert_1.default.strictEqual(r.partial, true);
    node_assert_1.default.strictEqual(r.headlineMs, undefined);
    node_assert_1.default.ok(r.milestones.every((m) => m.atMs === undefined));
    node_assert_1.default.ok(r.phases.every((p) => p.durationMs === undefined));
    node_assert_1.default.strictEqual(r.extensions[0].startMs, undefined);
    node_assert_1.default.strictEqual(r.extensions[0].deferred, false, 'eager and no restored mark: falls back to the eager flag');
});
//# sourceMappingURL=buildReport.test.js.map