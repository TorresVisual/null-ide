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
exports.parseIssueTemplate = parseIssueTemplate;
exports.loadIssueTemplates = loadIssueTemplates;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
function parseIssueTemplate(raw, fallbackName) {
    const match = raw.match(FRONTMATTER);
    if (!match)
        return { name: fallbackName, title: '', body: raw.trim(), labels: [] };
    const [, frontmatter, body] = match;
    const fields = {};
    for (const line of frontmatter.split(/\r?\n/)) {
        const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
        if (m)
            fields[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
    return {
        name: fields.name || fallbackName,
        title: fields.title || '',
        body: body.trim(),
        labels: fields.labels ? fields.labels.split(',').map(l => l.trim()).filter(Boolean) : [],
    };
}
function loadIssueTemplates(cwd) {
    const dir = path.join(cwd, '.github', 'ISSUE_TEMPLATE');
    let files;
    try {
        files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    }
    catch {
        return [];
    }
    return files.map(file => parseIssueTemplate(fs.readFileSync(path.join(dir, file), 'utf8'), file.replace(/\.md$/, '')));
}
//# sourceMappingURL=issueTemplates.js.map