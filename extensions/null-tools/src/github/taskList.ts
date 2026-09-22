'use strict';

const FENCE_RE = /^\s*(```|~~~)/;
const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[[ xX]\](.*)$/;

/**
 * Flips the nth GFM task-list checkbox (`- [ ]` / `- [x]`) in `body`, skipping
 * any inside fenced code blocks — mirrors the order marked.js emits `checkbox()`
 * renderer calls in, so `index` lines up with the webview's DOM order.
 */
export function toggleTaskCheckbox(body: string, index: number, checked: boolean): string | null {
  const lines = body.split('\n');
  let inFence = false;
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(TASK_RE);
    if (!m) continue;
    if (count === index) {
      lines[i] = `${m[1]}[${checked ? 'x' : ' '}]${m[2]}`;
      return lines.join('\n');
    }
    count++;
  }
  return null;
}
