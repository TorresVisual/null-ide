"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateClassName = validateClassName;
exports.headerFileName = headerFileName;
exports.sourceFileName = sourceFileName;
exports.headerContent = headerContent;
exports.sourceContent = sourceContent;
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
function validateClassName(name) {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
        return 'Class name cannot be empty.';
    }
    if (!VALID_NAME.test(trimmed)) {
        return 'Class name must start with a letter or underscore and contain only letters, numbers, and underscores.';
    }
    return undefined;
}
function headerFileName(name) {
    return `${name}.hpp`;
}
function sourceFileName(name) {
    return `${name}.cpp`;
}
function headerContent() {
    return '#pragma once\n\n';
}
function sourceContent(name) {
    return `#include "${headerFileName(name)}"\n\n`;
}
//# sourceMappingURL=scaffoldNaming.js.map