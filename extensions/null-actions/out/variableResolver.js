'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveVariables = resolveVariables;
const SIMPLE_VARS = [
    'workspaceFolder', 'file', 'fileBasename', 'fileDirname',
    'relativeFile', 'selectedText', 'lineNumber',
];
/** `missing`, when given, collects known variables that had no value (shell-style `${HOME}` is not one). */
function resolveVariables(template, ctx, missing) {
    return template.replace(/\$\{([a-zA-Z]+)(?::([a-zA-Z_][a-zA-Z0-9_]*))?\}/g, (match, name, envVar) => {
        if (name === 'env' && envVar) {
            const value = ctx.env?.[envVar];
            if (value === undefined) {
                missing?.push(match);
            }
            return value !== undefined ? value : match;
        }
        if (SIMPLE_VARS.includes(name)) {
            const value = ctx[name];
            if (value === undefined) {
                missing?.push(match);
            }
            return value !== undefined ? value : match;
        }
        return match;
    });
}
//# sourceMappingURL=variableResolver.js.map