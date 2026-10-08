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
exports.detectProjectType = detectProjectType;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
// Ordered: the first marker found decides the type.
const MARKERS = [
    { matches: names => names.includes('Cargo.toml'), info: { projectType: 'Rust', icon: 'rust' } },
    { matches: names => names.includes('CMakeLists.txt'), info: { projectType: 'CMake', icon: 'cmake' } },
    { matches: names => names.some(name => name.endsWith('.sln') || name.endsWith('.csproj')), info: { projectType: '.NET', icon: 'dotnet' } },
    { matches: names => names.includes('package.json'), info: { projectType: 'Node', icon: 'node' } },
];
/** Synchronous, single readdir of the project root. Returns undefined when nothing is recognised or the folder cannot be read. */
function detectProjectType(projectPath) {
    let names;
    try {
        names = fs.readdirSync(path.resolve(projectPath));
    }
    catch {
        return undefined;
    }
    return MARKERS.find(marker => marker.matches(names))?.info;
}
//# sourceMappingURL=projectType.js.map