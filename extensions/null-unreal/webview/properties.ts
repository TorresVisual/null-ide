import { describe } from '../src/viewer/value';
import type { ToWebview } from '../src/viewer/messages';
import { mountFrame } from './frame';

// A value that is itself a branch: a non-empty array, or an object that is not an {unreadable} marker.
const isBranch = (v: unknown): v is Record<string, unknown> | unknown[] =>
  Array.isArray(v) ? v.length > 0 : typeof v === 'object' && v !== null && !('unreadable' in v);

function row(key: string, value: unknown): HTMLElement {
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

const frame = mountFrame((m: ToWebview) => {
  if (m.type !== 'ready') return;
  for (const [k, v] of Object.entries(m.data)) frame.body.append(row(k, v));
});
