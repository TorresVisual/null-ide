import * as vscode from 'vscode';

export interface CppConfigState {
  activePresetName?: string;
  activeTargetName?: string;
  lastConfiguredAt?: number;
}

const STATE_KEY = 'null-cpp.cppConfigState';

export function getConfigState(context: vscode.ExtensionContext): CppConfigState {
  return context.workspaceState.get<CppConfigState>(STATE_KEY, {});
}

export async function setActivePreset(context: vscode.ExtensionContext, presetName: string | undefined): Promise<void> {
  const state = getConfigState(context);
  // A target name only makes sense within the preset it was selected under.
  await context.workspaceState.update(STATE_KEY, {
    ...state,
    activePresetName: presetName,
    activeTargetName: undefined,
  });
}

export async function setActiveTarget(context: vscode.ExtensionContext, targetName: string | undefined): Promise<void> {
  const state = getConfigState(context);
  await context.workspaceState.update(STATE_KEY, { ...state, activeTargetName: targetName });
}

export async function setLastConfiguredAt(context: vscode.ExtensionContext, timestamp: number): Promise<void> {
  const state = getConfigState(context);
  await context.workspaceState.update(STATE_KEY, { ...state, lastConfiguredAt: timestamp });
}
