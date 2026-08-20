'use strict';

export type ButtonType = 'terminal' | 'vscode-command';
export type ButtonAlignment = 'left' | 'right';
export type ButtonBackground = 'none' | 'warning' | 'error';

export interface WhenClauseConfig {
  languages?: string[];
  filesExist?: string[];
  folder?: string;
}

export interface ActionButtonConfig {
  id: string;
  label: string;
  icon?: string;
  type: ButtonType;
  command: string;
  args?: unknown[];
  color?: string;
  background: ButtonBackground;
  tooltip?: string;
  cwd?: string;
  saveAll: boolean;
  focus: boolean;
  alignment: ButtonAlignment;
  priority: number;
  when?: WhenClauseConfig;
}

export interface ParseResult {
  buttons: ActionButtonConfig[];
  errors: string[];
}

const VALID_TYPES: ButtonType[] = ['terminal', 'vscode-command'];
const VALID_ALIGNMENTS: ButtonAlignment[] = ['left', 'right'];
const VALID_BACKGROUNDS: ButtonBackground[] = ['none', 'warning', 'error'];

function parseWhenClause(raw: unknown): WhenClauseConfig | undefined {
  if (typeof raw !== 'object' || raw === null) { return undefined; }
  const w = raw as Record<string, unknown>;
  const languages = Array.isArray(w.languages)
    ? w.languages.filter((x): x is string => typeof x === 'string')
    : undefined;
  const filesExist = Array.isArray(w.filesExist)
    ? w.filesExist.filter((x): x is string => typeof x === 'string')
    : undefined;
  const folder = typeof w.folder === 'string' ? w.folder : undefined;
  if (!languages && !filesExist && !folder) { return undefined; }
  return { languages, filesExist, folder };
}

export function parseButtonConfigs(raw: unknown): ParseResult {
  const buttons: ActionButtonConfig[] = [];
  const errors: string[] = [];

  if (raw === undefined) {
    return { buttons, errors };
  }
  if (!Array.isArray(raw)) {
    return { buttons, errors: ['null-actions.buttons must be an array'] };
  }

  const seenIds = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    const prefix = `null-actions.buttons[${i}]`;

    if (typeof entry !== 'object' || entry === null) {
      errors.push(`${prefix}: entry must be an object`);
      continue;
    }
    const e = entry as Record<string, unknown>;

    if (typeof e.id !== 'string' || e.id.trim() === '') {
      errors.push(`${prefix}: missing required string field "id"`);
      continue;
    }
    if (seenIds.has(e.id)) {
      errors.push(`${prefix} (id=${e.id}): duplicate id, ignoring this entry`);
      continue;
    }
    if (typeof e.label !== 'string' || e.label.trim() === '') {
      errors.push(`${prefix} (id=${e.id}): missing required string field "label"`);
      continue;
    }
    if (typeof e.command !== 'string' || e.command.trim() === '') {
      errors.push(`${prefix} (id=${e.id}): missing required string field "command"`);
      continue;
    }

    seenIds.add(e.id);
    buttons.push({
      id: e.id,
      label: e.label,
      icon: typeof e.icon === 'string' ? e.icon : undefined,
      type: VALID_TYPES.includes(e.type as ButtonType) ? (e.type as ButtonType) : 'terminal',
      command: e.command,
      args: Array.isArray(e.args) ? e.args : undefined,
      color: typeof e.color === 'string' ? e.color : undefined,
      background: VALID_BACKGROUNDS.includes(e.background as ButtonBackground) ? (e.background as ButtonBackground) : 'none',
      tooltip: typeof e.tooltip === 'string' ? e.tooltip : undefined,
      cwd: typeof e.cwd === 'string' ? e.cwd : undefined,
      saveAll: e.saveAll === true,
      focus: e.focus === true,
      alignment: VALID_ALIGNMENTS.includes(e.alignment as ButtonAlignment) ? (e.alignment as ButtonAlignment) : 'left',
      priority: typeof e.priority === 'number' ? e.priority : 0,
      when: parseWhenClause(e.when),
    });
  }

  return { buttons, errors };
}
