"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfigState = getConfigState;
exports.setActivePreset = setActivePreset;
exports.setActiveTarget = setActiveTarget;
exports.setLastConfiguredAt = setLastConfiguredAt;
const STATE_KEY = 'null-cpp.cppConfigState';
function getConfigState(context) {
    return context.workspaceState.get(STATE_KEY, {});
}
async function setActivePreset(context, presetName) {
    const state = getConfigState(context);
    // A target name only makes sense within the preset it was selected under.
    await context.workspaceState.update(STATE_KEY, {
        ...state,
        activePresetName: presetName,
        activeTargetName: undefined,
    });
}
async function setActiveTarget(context, targetName) {
    const state = getConfigState(context);
    await context.workspaceState.update(STATE_KEY, { ...state, activeTargetName: targetName });
}
async function setLastConfiguredAt(context, timestamp) {
    const state = getConfigState(context);
    await context.workspaceState.update(STATE_KEY, { ...state, lastConfiguredAt: timestamp });
}
//# sourceMappingURL=cppConfigState.js.map