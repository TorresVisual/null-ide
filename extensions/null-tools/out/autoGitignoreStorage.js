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
exports.DEFAULT_ARTIFACT_PATTERNS = void 0;
exports.normalizePattern = normalizePattern;
exports.isPatternInGitignore = isPatternInGitignore;
exports.getMissingEntries = getMissingEntries;
exports.updateGitignoreContent = updateGitignoreContent;
exports.detectArtifactsInRoot = detectArtifactsInRoot;
exports.processWorkspaceAutoGitignore = processWorkspaceAutoGitignore;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
exports.DEFAULT_ARTIFACT_PATTERNS = [
    // JavaScript / Node.js
    'node_modules/',
    '.next/',
    '.nuxt/',
    '.turbo/',
    // Python
    '__pycache__/',
    'lib/__pycache__/',
    '.pytest_cache/',
    '.mypy_cache/',
    '*.pyc',
    '*.pyo',
    '*.egg-info/',
    'tests/tmp/',
    // Virtual environments
    '.venv/',
    'venv/',
    'env/',
    '.build-venv/',
    // Build outputs
    'dist/',
    'dist_web/',
    'build/',
    'build_web/',
    'out/',
    'target/',
    'bin/',
    'obj/',
    // Caches & tooling
    '.cache/',
    '.build-deps/',
    '.build-cache/',
    // Null IDE internals
    '.null/',
    // OS artifacts
    '.DS_Store',
    'Thumbs.db',
    // Logs
    '*.log',
    // Environment / secrets
    '.env',
    '.env.local',
    '.env.development.local',
    '.env.test.local',
    '.env.production.local',
    // Agentic / AI tooling noise
    '.claude/',
    '.codex-tmp/',
    '.superpowers/',
    '.playwright-mcp/',
];
const SECTION_HEADER = '# Added by Null IDE Auto-Gitignore';
function normalizePattern(pattern) {
    return pattern.trim();
}
function isPatternInGitignore(content, pattern) {
    const normalized = normalizePattern(pattern);
    const rawName = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
    const lines = content.split(/\r?\n/).map(l => l.trim());
    return lines.some(line => {
        if (!line || line.startsWith('#')) {
            return false;
        }
        const cleanLine = line.endsWith('/') ? line.slice(0, -1) : line;
        return line === normalized || cleanLine === rawName || line === `/${normalized}` || line === `/${rawName}`;
    });
}
function getMissingEntries(existingGitignore, detectedArtifacts) {
    return detectedArtifacts.filter(pattern => !isPatternInGitignore(existingGitignore, pattern));
}
function updateGitignoreContent(existingContent, missingEntries) {
    if (missingEntries.length === 0) {
        return existingContent;
    }
    let updated = existingContent;
    if (updated && !updated.endsWith('\n')) {
        updated += '\n';
    }
    if (!updated.includes(SECTION_HEADER)) {
        updated += `\n${SECTION_HEADER}\n`;
    }
    for (const entry of missingEntries) {
        updated += `${entry}\n`;
    }
    return updated;
}
function detectArtifactsInRoot(rootPath, patterns) {
    const detected = [];
    for (const pattern of patterns) {
        const isDirPattern = pattern.endsWith('/');
        const relName = isDirPattern ? pattern.slice(0, -1) : pattern;
        if (relName.includes('*')) {
            try {
                const files = fs.readdirSync(rootPath);
                const ext = relName.replace('*', '');
                if (files.some(f => f.endsWith(ext))) {
                    detected.push(pattern);
                }
            }
            catch { /* ignore */ }
            continue;
        }
        const fullPath = path.join(rootPath, relName);
        try {
            if (fs.existsSync(fullPath)) {
                const stat = fs.statSync(fullPath);
                if (isDirPattern && stat.isDirectory()) {
                    detected.push(pattern);
                }
                else if (!isDirPattern) {
                    detected.push(pattern);
                }
            }
        }
        catch { /* ignore */ }
    }
    return detected;
}
async function processWorkspaceAutoGitignore(rootPath, patterns, autoCommit, output) {
    const gitignorePath = path.join(rootPath, '.gitignore');
    let existingContent = '';
    try {
        if (fs.existsSync(gitignorePath)) {
            existingContent = fs.readFileSync(gitignorePath, 'utf8');
        }
    }
    catch (err) {
        output?.appendLine(`Error reading .gitignore: ${err.message}`);
    }
    const detected = detectArtifactsInRoot(rootPath, patterns);
    const missing = getMissingEntries(existingContent, detected);
    if (missing.length === 0) {
        return { updated: false, added: [], committed: false };
    }
    const newContent = updateGitignoreContent(existingContent, missing);
    fs.writeFileSync(gitignorePath, newContent, 'utf8');
    output?.appendLine(`Null Auto-Gitignore added entries to .gitignore: ${missing.join(', ')}`);
    let committed = false;
    if (autoCommit) {
        try {
            const gitDir = path.join(rootPath, '.git');
            if (fs.existsSync(gitDir)) {
                await execAsync(`git add .gitignore`, { cwd: rootPath });
                const commitMsg = `chore: auto-update .gitignore with ${missing.join(', ')} [Null IDE]`;
                await execAsync(`git commit -m "${commitMsg}"`, { cwd: rootPath });
                committed = true;
                output?.appendLine(`Null Auto-Gitignore auto-committed updated .gitignore`);
            }
        }
        catch (err) {
            output?.appendLine(`Could not auto-commit .gitignore: ${err.message}`);
        }
    }
    return { updated: true, added: missing, committed };
}
//# sourceMappingURL=autoGitignoreStorage.js.map