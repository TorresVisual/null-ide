'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveVariables = resolveVariables;
const SIMPLE_VARS = [
    'workspaceFolder', 'file', 'fileBasename', 'fileDirname',
    'relativeFile', 'selectedText', 'lineNumber',
];
function resolveVariables(template, ctx) {
    return template.replace(/\$\{([a-zA-Z]+)(?::([a-zA-Z_][a-zA-Z0-9_]*))?\}/g, (match, name, envVar) => {
        if (name === 'env' && envVar) {
            const value = ctx.env?.[envVar];
            return value !== undefined ? value : match;
        }
        if (SIMPLE_VARS.includes(name)) {
            const value = ctx[name];
            return value !== undefined ? value : match;
        }
        return match;
    });
}
//# sourceMappingURL=variableResolver.js.map