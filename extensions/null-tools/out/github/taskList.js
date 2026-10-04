'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.toggleTaskCheckbox = toggleTaskCheckbox;
const FENCE_RE = /^\s*(```|~~~)/;
const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[[ xX]\](.*)$/;
/**
 * Flips the nth GFM task-list checkbox (`- [ ]` / `- [x]`) in `body`, skipping
 * any inside fenced code blocks — mirrors the order GitHub renders task items
 * in `bodyHTML`, so `index` lines up with the webview's DOM order.
 */
function toggleTaskCheckbox(body, index, checked) {
    const lines = body.split('\n');
    let inFence = false;
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (FENCE_RE.test(line)) {
            inFence = !inFence;
            continue;
        }
        if (inFence)
            continue;
        const m = line.match(TASK_RE);
        if (!m)
            continue;
        if (count === index) {
            lines[i] = `${m[1]}[${checked ? 'x' : ' '}]${m[2]}`;
            return lines.join('\n');
        }
        count++;
    }
    return null;
}
//# sourceMappingURL=taskList.js.map