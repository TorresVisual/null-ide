'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.PHASES = void 0;
exports.markTime = markTime;
exports.launchStart = launchStart;
exports.buildReport = buildReport;
const intervals_1 = require("./intervals");
const sanitize_1 = require("./sanitize");
const types_1 = require("./types");
/** Every pair is a will/did mark pair that upstream sets; a pair with a missing mark yields `n/a`. */
exports.PHASES = [
    { id: 'window-state', label: 'Restore window state', process: 'main', from: 'code/willRestoreCodeWindowState', to: 'code/didRestoreCodeWindowState' },
    { id: 'window-create', label: 'Create window', process: 'main', from: 'code/willCreateCodeWindow', to: 'code/didCreateCodeWindow' },
    { id: 'load-workbench', label: 'Load workbench bundle', process: 'renderer', from: 'code/willLoadWorkbenchMain', to: 'code/didLoadWorkbenchMain' },
    { id: 'window-config', label: 'Wait for window config', process: 'renderer', from: 'code/willWaitForWindowConfig', to: 'code/didWaitForWindowConfig' },
    { id: 'storage', label: 'Init storage', process: 'renderer', from: 'code/willInitStorage', to: 'code/didInitStorage' },
    { id: 'workspace-service', label: 'Init workspace service', process: 'renderer', from: 'code/willInitWorkspaceService', to: 'code/didInitWorkspaceService' },
    { id: 'shared-process', label: 'Connect shared process', process: 'renderer', from: 'code/willConnectSharedProcess', to: 'code/didConnectSharedProcess' },
    { id: 'workbench', label: 'Start workbench', process: 'renderer', from: 'code/willStartWorkbench', to: 'code/didStartWorkbench' },
    { id: 'extensions', label: 'Register extensions', process: 'renderer', from: 'code/willLoadExtensions', to: 'code/didLoadExtensions' },
    { id: 'viewlet', label: 'Restore sidebar', process: 'renderer', from: 'code/willRestoreViewlet', to: 'code/didRestoreViewlet' },
    { id: 'panel', label: 'Restore panel', process: 'renderer', from: 'code/willRestorePanel', to: 'code/didRestorePanel' },
    { id: 'editors', label: 'Restore editors', process: 'renderer', from: 'code/willRestoreEditors', to: 'code/didRestoreEditors' },
];
const MILESTONES = [
    { id: 'windowCreated', label: 'Window created', mark: 'code/didCreateCodeWindow' },
    { id: 'uiInteractive', label: 'UI interactive', mark: 'code/didStartWorkbench' },
    { id: 'workspaceRestored', label: 'Workspace restored', mark: 'code/didRestoreEditors' },
    { id: 'extensionsSettled', label: 'Extensions settled' },
];
function markTime(snapshot, name) {
    return snapshot.marks.find((m) => m.name === name)?.startTime;
}
/** Epoch ms of the launch: the main-process start, or the window-open mark for later windows. */
function launchStart(snapshot) {
    const first = snapshot.initialStartup ? 'code/didStartMain' : 'code/willOpenNewWindow';
    return markTime(snapshot, first) ?? markTime(snapshot, 'code/timeOrigin');
}
function buildReport(snapshot, opts) {
    const start = launchStart(snapshot);
    const off = (t) => (t === undefined || start === undefined ? undefined : t - start);
    const sum = (...v) => (v.every((x) => x !== undefined) ? v.reduce((a, b) => a + b, 0) : undefined);
    const phases = exports.PHASES.map((p) => {
        const startMs = off(markTime(snapshot, p.from));
        const endMs = off(markTime(snapshot, p.to));
        const durationMs = startMs !== undefined && endMs !== undefined ? Math.max(0, endMs - startMs) : undefined;
        return { id: p.id, label: p.label, process: p.process, startMs, endMs, durationMs };
    });
    const measured = phases.filter((p) => p.durationMs !== undefined);
    (0, intervals_1.incrementalImpact)(measured.map((p) => ({ start: p.startMs, end: p.endMs }))).forEach((v, i) => (measured[i].impactMs = v));
    const restoredAbs = markTime(snapshot, 'code/didRestoreEditors');
    const extensions = snapshot.extensions.map((e) => ({
        id: e.id,
        activationEvent: (0, sanitize_1.sanitizeEvent)(e.activationEvent),
        reason: e.reason,
        eager: e.eager,
        deferred: e.endMs !== undefined && restoredAbs !== undefined ? e.endMs > restoredAbs : !e.eager,
        startMs: off(e.startMs),
        endMs: off(e.endMs),
        loadMs: e.loadMs,
        callMs: e.callMs,
        resolveMs: e.resolveMs,
        totalMs: sum(e.loadMs, e.callMs, e.resolveMs),
    }));
    const timed = extensions.filter((e) => e.startMs !== undefined && e.endMs !== undefined);
    (0, intervals_1.incrementalImpact)(timed.map((e) => ({ start: e.startMs, end: e.endMs }))).forEach((v, i) => (timed[i].impactMs = v));
    const settledEnds = extensions.filter((e) => e.eager && e.endMs !== undefined).map((e) => e.endMs);
    const milestones = MILESTONES.map((m) => ({
        id: m.id,
        label: m.label,
        atMs: m.mark ? off(markTime(snapshot, m.mark)) : settledEnds.length ? Math.max(...settledEnds) : undefined,
    }));
    return {
        schemaVersion: types_1.SCHEMA_VERSION,
        id: opts.id,
        windowId: opts.windowId,
        takenAt: snapshot.takenAt,
        appVersion: snapshot.appVersion,
        initialStartup: snapshot.initialStartup,
        partial: start === undefined,
        headlineMs: milestones.find((m) => m.id === 'workspaceRestored')?.atMs,
        milestones,
        phases,
        extensions,
    };
}
//# sourceMappingURL=buildReport.js.map