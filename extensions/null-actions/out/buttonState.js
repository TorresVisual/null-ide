'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDuration = formatDuration;
exports.statusText = statusText;
exports.statusTooltip = statusTooltip;
function formatDuration(ms) {
    if (ms < 1000) {
        return `${Math.round(ms)}ms`;
    }
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
const RESULT_ICON = { passed: 'check', failed: 'error', ended: 'debug-stop' };
/** Status bar text for a button: its normal text, or the run state overlaid on it. */
function statusText(label, icon, state) {
    if (!state) {
        return icon ? `$(${icon}) ${label}` : label;
    }
    if (state.kind === 'running') {
        return `$(sync~spin) ${label}`;
    }
    return `$(${RESULT_ICON[state.kind]}) ${label} ${formatDuration(state.durationMs)}`;
}
function statusTooltip(tooltip, state) {
    if (!state) {
        return tooltip;
    }
    let line;
    if (state.kind === 'running') {
        line = 'Running...';
    }
    else if (state.kind === 'passed') {
        line = `Passed in ${formatDuration(state.durationMs)}`;
    }
    else if (state.kind === 'failed') {
        line = `Failed with exit code ${state.exitCode} after ${formatDuration(state.durationMs)} - click to show the terminal`;
    }
    else {
        line = `Finished after ${formatDuration(state.durationMs)} (exit code unknown)`;
    }
    return tooltip ? `${tooltip}\n${line}` : line;
}
//# sourceMappingURL=buttonState.js.map