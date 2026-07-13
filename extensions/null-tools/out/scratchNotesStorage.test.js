"use strict";
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
const node_test_1 = require("node:test");
const assert = __importStar(require("node:assert/strict"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const scratchNotesStorage_1 = require("./scratchNotesStorage");
(0, node_test_1.test)('getScratchDir and getNotesDir nest under .null inside the workspace root', () => {
    const root = 'C:\\Projects\\Foo';
    assert.equal((0, scratchNotesStorage_1.getNullDir)(root), path.join(root, '.null'));
    assert.equal((0, scratchNotesStorage_1.getScratchDir)(root), path.join(root, '.null', 'scratch'));
    assert.equal((0, scratchNotesStorage_1.getNotesDir)(root), path.join(root, '.null', 'notes'));
});
(0, node_test_1.test)('formatTimestamp zero-pads month/day/hour/minute/second', () => {
    const date = new Date(2026, 0, 5, 9, 3, 7); // Jan 5 2026, 09:03:07
    assert.equal((0, scratchNotesStorage_1.formatTimestamp)(date), '20260105-090307');
});
(0, node_test_1.test)('buildScratchFilename combines the scratch prefix, timestamp, and extension', () => {
    const date = new Date(2026, 0, 5, 9, 3, 7);
    assert.equal((0, scratchNotesStorage_1.buildScratchFilename)('.ts', date), 'scratch-20260105-090307.ts');
});
(0, node_test_1.test)('slugify lowercases, hyphenates, and trims non-alphanumeric runs', () => {
    assert.equal((0, scratchNotesStorage_1.slugify)('Meeting Notes: Q3 Plan!'), 'meeting-notes-q3-plan');
    assert.equal((0, scratchNotesStorage_1.slugify)('  leading/trailing  '), 'leading-trailing');
});
(0, node_test_1.test)('slugify falls back to "note" when nothing alphanumeric remains', () => {
    assert.equal((0, scratchNotesStorage_1.slugify)('***'), 'note');
});
(0, node_test_1.test)('buildNoteFilename appends -2, -3, ... on collision', () => {
    assert.equal((0, scratchNotesStorage_1.buildNoteFilename)('Ideas', []), 'ideas.md');
    assert.equal((0, scratchNotesStorage_1.buildNoteFilename)('Ideas', ['ideas.md']), 'ideas-2.md');
    assert.equal((0, scratchNotesStorage_1.buildNoteFilename)('Ideas', ['ideas.md', 'ideas-2.md']), 'ideas-3.md');
});
(0, node_test_1.test)('deriveNoteLabel prefers the first markdown heading', () => {
    assert.equal((0, scratchNotesStorage_1.deriveNoteLabel)('C:\\ws\\.null\\notes\\ideas.md', '# Project Ideas\n\nsome text'), 'Project Ideas');
});
(0, node_test_1.test)('deriveNoteLabel falls back to the filename when there is no heading', () => {
    assert.equal((0, scratchNotesStorage_1.deriveNoteLabel)('C:\\ws\\.null\\notes\\ideas.md', 'no heading here'), 'ideas');
});
(0, node_test_1.test)('ensureDir creates nested directories', () => {
    const base = path.join(os.tmpdir(), `null-scratch-ensuredir-${process.pid}`);
    const dir = path.join(base, 'a', 'b');
    try {
        (0, scratchNotesStorage_1.ensureDir)(dir);
        assert.equal(fs.existsSync(dir), true);
    }
    finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('ensureGitignoreEntry appends .null/ to a missing .gitignore', () => {
    const root = path.join(os.tmpdir(), `null-gitignore-missing-${process.pid}`);
    fs.mkdirSync(root, { recursive: true });
    try {
        (0, scratchNotesStorage_1.ensureGitignoreEntry)(root);
        const content = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
        assert.equal(content, '.null/\n');
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('ensureGitignoreEntry appends to an existing .gitignore without a trailing newline', () => {
    const root = path.join(os.tmpdir(), `null-gitignore-existing-${process.pid}`);
    fs.mkdirSync(root, { recursive: true });
    try {
        fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/');
        (0, scratchNotesStorage_1.ensureGitignoreEntry)(root);
        const content = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
        assert.equal(content, 'node_modules/\n.null/\n');
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('ensureGitignoreEntry is idempotent', () => {
    const root = path.join(os.tmpdir(), `null-gitignore-idempotent-${process.pid}`);
    fs.mkdirSync(root, { recursive: true });
    try {
        (0, scratchNotesStorage_1.ensureGitignoreEntry)(root);
        (0, scratchNotesStorage_1.ensureGitignoreEntry)(root);
        const content = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
        assert.equal(content, '.null/\n');
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('buildScratchRunCommand maps .py to a quoted python invocation', () => {
    assert.equal((0, scratchNotesStorage_1.buildScratchRunCommand)('C:\\ws\\.null\\scratch\\scratch-1.py'), 'python "C:\\ws\\.null\\scratch\\scratch-1.py"');
});
(0, node_test_1.test)('buildScratchRunCommand maps .js to a quoted node invocation', () => {
    assert.equal((0, scratchNotesStorage_1.buildScratchRunCommand)('C:\\ws\\.null\\scratch\\scratch-1.js'), 'node "C:\\ws\\.null\\scratch\\scratch-1.js"');
});
(0, node_test_1.test)('buildScratchRunCommand maps .ts to a quoted npx ts-node invocation', () => {
    assert.equal((0, scratchNotesStorage_1.buildScratchRunCommand)('C:\\ws\\.null\\scratch\\scratch-1.ts'), 'npx "ts-node" "C:\\ws\\.null\\scratch\\scratch-1.ts"');
});
(0, node_test_1.test)('buildScratchRunCommand returns undefined for non-runnable extensions', () => {
    assert.equal((0, scratchNotesStorage_1.buildScratchRunCommand)('C:\\ws\\.null\\scratch\\scratch-1.md'), undefined);
    assert.equal((0, scratchNotesStorage_1.buildScratchRunCommand)('C:\\ws\\.null\\scratch\\scratch-1.json'), undefined);
    assert.equal((0, scratchNotesStorage_1.buildScratchRunCommand)('C:\\ws\\.null\\scratch\\scratch-1.txt'), undefined);
    assert.equal((0, scratchNotesStorage_1.buildScratchRunCommand)('C:\\ws\\.null\\scratch\\scratch-1.unknown'), undefined);
});
//# sourceMappingURL=scratchNotesStorage.test.js.map