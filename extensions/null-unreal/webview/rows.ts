import { describe } from '../src/viewer/value';

// A value that is itself a branch: a non-empty array, or an object that is not an {unreadable} marker.
const isBranch = (v: unknown): v is Record<string, unknown> | unknown[] =>
  Array.isArray(v) ? v.length > 0 : typeof v === 'object' && v !== null && !('unreadable' in v);

// One key/value line, or a collapsible branch for nested values.
export function row(key: string, value: unknown): HTMLElement {
  if (!isBranch(value)) {
    const r = document.createElement('div');
    r.className = 'row';
    const k = document.createElement('span');
    k.className = 'key';
    k.textContent = key;
    const v = document.createElement('span');
    v.className = 'value';
    v.textContent = describe(value);
    r.append(k, v);
    return r;
  }
  const d = document.createElement('details');
  d.open = true;
  const s = document.createElement('summary');
  s.textContent = `${key} (${describe(value)})`;
  d.append(s);
  for (const [k, v] of Object.entries(value)) d.append(row(k, v));
  return d;
}

// The generic view: an export's data as a collapsible tree. Also the fallback when a page cannot draw its asset.
export function renderTree(data: Record<string, unknown>, into: HTMLElement): void {
  for (const [k, v] of Object.entries(data)) into.append(row(k, v));
}
