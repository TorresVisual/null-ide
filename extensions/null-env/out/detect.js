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
exports.detectProjects = detectProjects;
exports.detectLanguages = detectLanguages;
const fs = __importStar(require("node:fs"));
// The one manifest -> language table. Order is the order results are reported in.
const MATCHERS = [
    { language: 'rust', exact: 'Cargo.toml' },
    { language: 'cpp', exact: 'CMakeLists.txt' },
    { language: 'cpp', exact: 'compile_commands.json' },
    { language: 'cpp', exact: '.clangd' },
    { language: 'node', exact: 'package.json' },
    { language: 'dotnet', suffix: '.csproj' },
];
const defaultListDir = (folderPath) => fs.readdirSync(folderPath);
function detectProjects(folderPath, listDir = defaultListDir) {
    let names;
    try {
        names = listDir(folderPath).map(n => n.toLowerCase());
    }
    catch {
        return [];
    }
    const found = [];
    for (const m of MATCHERS) {
        const hit = names.some(n => (m.exact ? n === m.exact.toLowerCase() : n.endsWith(m.suffix)));
        if (hit) {
            found.push({ language: m.language, manifest: (m.exact ?? m.suffix) });
        }
    }
    return found;
}
function detectLanguages(folderPath, listDir) {
    return [...new Set(detectProjects(folderPath, listDir).map(p => p.language))];
}
//# sourceMappingURL=detect.js.map