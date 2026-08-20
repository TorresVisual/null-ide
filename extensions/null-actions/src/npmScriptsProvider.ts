'use strict';

import { ActionButtonConfig } from './buttonConfig';

export interface NpmScriptButton {
  id: string;
  label: string;
  command: string;
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
    buttons.push({ id: `npm-${name}`, label: `npm run ${name}`, command: `npm run ${name}` });
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
    focus: false,
    alignment: 'left',
    priority,
    when: undefined,
  };
}
