'use strict';

import { parse } from 'yaml';

export type InputType = 'string' | 'boolean' | 'choice' | 'number' | 'environment';
export interface DispatchInput {
  name: string; description: string; required: boolean; default: string | null; type: InputType; options: string[];
}

const TYPES: ReadonlySet<string> = new Set<InputType>(['string', 'boolean', 'choice', 'number', 'environment']);
const MAX_BYTES = 1_000_000;
const MAX_INPUTS = 50;

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Whether a workflow file has a `workflow_dispatch` trigger, and its inputs. `on` may be a string, a list or a map, and
 * a YAML 1.1 reader turns the key into boolean `true`, so both spellings are read. Anything unreadable is "not dispatchable".
 */
export function parseDispatch(text: string): { dispatchable: boolean; inputs: DispatchInput[] } {
  const none = { dispatchable: false, inputs: [] as DispatchInput[] };
  if (text.length > MAX_BYTES) return none;
  let doc: unknown;
  try {
    doc = parse(text, { merge: true });
  } catch {
    return none;
  }
  if (!isMap(doc)) return none;
  const on = doc.on ?? doc.true;
  if (on === 'workflow_dispatch') return { dispatchable: true, inputs: [] };
  if (Array.isArray(on)) return { dispatchable: on.includes('workflow_dispatch'), inputs: [] };
  if (!isMap(on) || !('workflow_dispatch' in on)) return none;

  const trigger = on.workflow_dispatch;
  const raw = isMap(trigger) && isMap(trigger.inputs) ? trigger.inputs : {};
  const inputs: DispatchInput[] = [];
  for (const [name, spec] of Object.entries(raw)) {
    if (inputs.length >= MAX_INPUTS) break;
    const s: Record<string, unknown> | null = spec === null || spec === undefined ? {} : isMap(spec) ? spec : null;
    if (s === null) continue; // an entry that is a number or a list is not an input
    const type: InputType = typeof s.type === 'string' && TYPES.has(s.type) ? (s.type as InputType) : 'string';
    inputs.push({
      name,
      description: typeof s.description === 'string' ? s.description : '',
      required: s.required === true,
      default: s.default === undefined || s.default === null ? null : String(s.default),
      type,
      options: Array.isArray(s.options) ? s.options.map(String) : [],
    });
  }
  return { dispatchable: true, inputs };
}

/** InputBox validation for one value; undefined means fine. */
export function validateInput(input: DispatchInput, value: string): string | undefined {
  if (input.required && value.trim() === '') return `${input.name} is required.`;
  if (value === '') return undefined;
  if (input.type === 'number' && Number.isNaN(Number(value))) return `${input.name} must be a number.`;
  if (input.type === 'choice' && !input.options.includes(value)) return `${input.name} must be one of: ${input.options.join(', ')}.`;
  return undefined;
}
