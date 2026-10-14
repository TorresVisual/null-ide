'use strict';

import { ActionButtonConfig } from './buttonConfig';

export interface NpmScriptButton {
  id: string;
  label: string;
  command: string;
  problemMatcher?: string;
}

// ponytail: keyword guess on the script body; scripts that wrap tsc/eslint in another tool get no matcher.
function matcherFor(script: string): string | undefined {
  if (/\btsc\b/.test(script)) { return '$tsc'; }
  if (/\beslint\b/.test(script)) { return '$eslint-stylish'; }
  return undefined;
}

export function parseNpmScripts(packageJsonContent: string): NpmScriptButton[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJsonContent);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) { return []; }

  const scripts = (parsed as Record<string, unknown>).scripts;
  if (typeof scripts !== 'object' || scripts === null) { return []; }

  const buttons: NpmScriptButton[] = [];
  for (const [name, value] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof value !== 'string') { continue; }
    const button: NpmScriptButton = { id: `npm-${name}`, label: `npm run ${name}`, command: `npm run ${name}` };
    const problemMatcher = matcherFor(value);
    if (problemMatcher) { button.problemMatcher = problemMatcher; }
    buttons.push(button);
  }
  return buttons;
}

export function toActionButtonConfig(script: NpmScriptButton, priority: number): ActionButtonConfig {
  return {
    id: script.id,
    label: script.label,
    icon: undefined,
    type: 'terminal',
    command: script.command,
    args: undefined,
    color: undefined,
    background: 'none',
    tooltip: undefined,
    cwd: undefined,
    saveAll: false,
    focus: true,
    onBusy: 'ask',
    problemMatcher: script.problemMatcher,
    priority,
  };
}
