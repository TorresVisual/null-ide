'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseNpmScripts = parseNpmScripts;
exports.toActionButtonConfig = toActionButtonConfig;
function parseNpmScripts(packageJsonContent) {
    let parsed;
    try {
        parsed = JSON.parse(packageJsonContent);
    }
    catch {
        return [];
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return [];
    }
    const scripts = parsed.scripts;
    if (typeof scripts !== 'object' || scripts === null) {
        return [];
    }
    const buttons = [];
    for (const [name, value] of Object.entries(scripts)) {
        if (typeof value !== 'string') {
            continue;
        }
        buttons.push({ id: `npm-${name}`, label: `npm run ${name}`, command: `npm run ${name}` });
    }
    return buttons;
}
function toActionButtonConfig(script, priority) {
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
        priority,
        when: undefined,
    };
}
//# sourceMappingURL=npmScriptsProvider.js.map