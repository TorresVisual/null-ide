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
exports.detectSuggestedButtons = detectSuggestedButtons;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const DETECTORS = [
    {
        manifest: 'Cargo.toml',
        suggestions: [
            { id: 'cargo-run', label: 'cargo run', command: 'cargo run', icon: 'play' },
            { id: 'cargo-build', label: 'cargo build', command: 'cargo build', icon: 'tools' },
            { id: 'cargo-test', label: 'cargo test', command: 'cargo test', icon: 'beaker' },
        ],
    },
    {
        manifest: 'CMakeLists.txt',
        suggestions: [
            { id: 'cmake-configure', label: 'cmake configure', command: 'cmake -B build', icon: 'gear' },
            { id: 'cmake-build', label: 'cmake build', command: 'cmake --build build', icon: 'tools' },
        ],
    },
];
function detectSuggestedButtons(folderPath) {
    const suggestions = [];
    for (const detector of DETECTORS) {
        if (fs.existsSync(path.join(folderPath, detector.manifest))) {
            suggestions.push(...detector.suggestions);
        }
    }
    let entries = [];
    try {
        entries = fs.readdirSync(folderPath);
    }
    catch {
        entries = [];
    }
    if (entries.some(f => f.endsWith('.csproj'))) {
        suggestions.push({ id: 'dotnet-build', label: 'dotnet build', command: 'dotnet build', icon: 'tools' }, { id: 'dotnet-run', label: 'dotnet run', command: 'dotnet run', icon: 'play' });
    }
    return suggestions;
}
//# sourceMappingURL=projectDetector.js.map