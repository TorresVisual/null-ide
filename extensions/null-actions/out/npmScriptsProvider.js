'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseNpmScripts = parseNpmScripts;
exports.toActionButtonConfig = toActionButtonConfig;
// ponytail: keyword guess on the script body; scripts that wrap tsc/eslint in another tool get no matcher.
function matcherFor(script) {
    if (/\btsc\b/.test(script)) {
        return '$tsc';
    }
    if (/\beslint\b/.test(script)) {
        return '$eslint-stylish';
    }
    return undefined;
}
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
        const button = { id: `npm-${name}`, label: `npm run ${name}`, command: `npm run ${name}` };
        const problemMatcher = matcherFor(value);
        if (problemMatcher) {
            button.problemMatcher = problemMatcher;
        }
        buttons.push(button);
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
        focus: true,
        onBusy: 'ask',
        problemMatcher: script.problemMatcher,
        priority,
    };
}
//# sourceMappingURL=npmScriptsProvider.js.map