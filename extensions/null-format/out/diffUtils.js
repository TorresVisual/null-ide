"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeMinimalEdits = computeMinimalEdits;
exports.offsetToPosition = offsetToPosition;
/**
 * Calculates a minimal text replacement between original and formatted text.
 * Finds the common prefix and suffix to avoid replacing the entire document
 * when only small changes occurred.
 */
function computeMinimalEdits(original, formatted) {
    if (original === formatted) {
        return [];
    }
    let prefixLength = 0;
    const minLength = Math.min(original.length, formatted.length);
    while (prefixLength < minLength && original[prefixLength] === formatted[prefixLength]) {
        prefixLength++;
    }
    let originalSuffixLength = 0;
    let formattedSuffixLength = 0;
    while (prefixLength + originalSuffixLength < original.length &&
        prefixLength + formattedSuffixLength < formatted.length &&
        original[original.length - 1 - originalSuffixLength] === formatted[formatted.length - 1 - formattedSuffixLength]) {
        originalSuffixLength++;
        formattedSuffixLength++;
    }
    const editStartOffset = prefixLength;
    const editEndOffset = original.length - originalSuffixLength;
    const replacementText = formatted.slice(prefixLength, formatted.length - formattedSuffixLength);
    // Convert character offsets into line/char positions
    const startPos = offsetToPosition(original, editStartOffset);
    const endPos = offsetToPosition(original, editEndOffset);
    return [
        {
            startLine: startPos.line,
            startChar: startPos.character,
            endLine: endPos.line,
            endChar: endPos.character,
            newText: replacementText,
        },
    ];
}
function offsetToPosition(text, offset) {
    let line = 0;
    let character = 0;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === '\n') {
            line++;
            character = 0;
        }
        else {
            character++;
        }
    }
    return { line, character };
}
//# sourceMappingURL=diffUtils.js.map