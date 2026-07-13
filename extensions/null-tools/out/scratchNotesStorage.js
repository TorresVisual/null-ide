'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCRATCH_LANGUAGES = void 0;
exports.getNullDir = getNullDir;
exports.getScratchDir = getScratchDir;
exports.getNotesDir = getNotesDir;
exports.ensureDir = ensureDir;
exports.formatTimestamp = formatTimestamp;
exports.buildScratchFilename = buildScratchFilename;
exports.slugify = slugify;
exports.buildNoteFilename = buildNoteFilename;
exports.deriveNoteLabel = deriveNoteLabel;
exports.ensureGitignoreEntry = ensureGitignoreEntry;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.SCRATCH_LANGUAGES = [
    { label: 'JavaScript', extension: '.js' },
    { label: 'TypeScript', extension: '.ts' },
    { label: 'Python', extension: '.py' },
    { label: 'Markdown', extension: '.md' },
    { label: 'JSON', extension: '.json' },
    { label: 'Plain Text', extension: '.txt' },
];
function getNullDir(workspaceRoot) {
    return path.join(workspaceRoot, '.null');
}
function getScratchDir(workspaceRoot) {
    return path.join(getNullDir(workspaceRoot), 'scratch');
}
function getNotesDir(workspaceRoot) {
    return path.join(getNullDir(workspaceRoot), 'notes');
}
function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}
function pad(n) {
    return n.toString().padStart(2, '0');
}
function formatTimestamp(date) {
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
        `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
function buildScratchFilename(extension, date = new Date()) {
    return `scratch-${formatTimestamp(date)}${extension}`;
}
function slugify(title) {
    const slug = title
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || 'note';
}
function buildNoteFilename(title, existingFilenames) {
    const base = slugify(title);
    const existing = new Set(existingFilenames);
    let candidate = `${base}.md`;
    let n = 2;
    while (existing.has(candidate)) {
        candidate = `${base}-${n}.md`;
        n++;
    }
    return candidate;
}
function deriveNoteLabel(filePath, content) {
    const match = content.match(/^#\s+(.+)$/m);
    if (match) {
        return match[1].trim();
    }
    return path.basename(filePath, '.md');
}
function ensureGitignoreEntry(workspaceRoot) {
    const gitignorePath = path.join(workspaceRoot, '.gitignore');
    let content;
    try {
        content = fs.readFileSync(gitignorePath, 'utf8');
    }
    catch {
        content = '';
    }
    const alreadyPresent = content.split(/\r?\n/).some(line => line.trim() === '.null/');
    if (alreadyPresent) {
        return;
    }
    const needsLeadingNewline = content.length > 0 && !content.endsWith('\n');
    fs.writeFileSync(gitignorePath, `${content}${needsLeadingNewline ? '\n' : ''}.null/\n`);
}
//# sourceMappingURL=scratchNotesStorage.js.map