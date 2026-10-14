'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseButtonConfigs = parseButtonConfigs;
const VALID_TYPES = ['terminal', 'vscode-command'];
const VALID_BACKGROUNDS = ['none', 'warning', 'error'];
const VALID_ON_BUSY = ['ask', 'restart', 'show', 'run'];
function parseButtonConfigs(raw) {
    const buttons = [];
    const errors = [];
    if (raw === undefined) {
        return { buttons, errors };
    }
    if (!Array.isArray(raw)) {
        return { buttons, errors: ['null-actions.buttons must be an array'] };
    }
    const seenIds = new Set();
    for (let i = 0; i < raw.length; i++) {
        const entry = raw[i];
        const prefix = `null-actions.buttons[${i}]`;
        if (typeof entry !== 'object' || entry === null) {
            errors.push(`${prefix}: entry must be an object`);
            continue;
        }
        const e = entry;
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
            type: VALID_TYPES.includes(e.type) ? e.type : 'terminal',
            command: e.command,
            args: Array.isArray(e.args) ? e.args : undefined,
            color: typeof e.color === 'string' ? e.color : undefined,
            background: VALID_BACKGROUNDS.includes(e.background) ? e.background : 'none',
            tooltip: typeof e.tooltip === 'string' ? e.tooltip : undefined,
            cwd: typeof e.cwd === 'string' ? e.cwd : undefined,
            saveAll: e.saveAll === true,
            focus: typeof e.focus === 'boolean' ? e.focus : true,
            onBusy: VALID_ON_BUSY.includes(e.onBusy) ? e.onBusy : 'ask',
            problemMatcher: typeof e.problemMatcher === 'string' && e.problemMatcher.trim() !== '' ? e.problemMatcher.trim() : undefined,
            priority: typeof e.priority === 'number' ? e.priority : 0,
        });
    }
    return { buttons, errors };
}
//# sourceMappingURL=buttonConfig.js.map