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
exports.initializeProjectDetection = initializeProjectDetection;
exports.isEnabled = isEnabled;
const vscode = __importStar(require("vscode"));
const BUILD_CONFIG_GLOB = '**/{CMakeLists.txt,compile_commands.json,.clangd}';
const SOURCE_FILE_GLOB = '**/*.{c,cpp,cc,cxx,h,hpp,hh,hxx}';
const EXCLUDE_GLOB = '**/node_modules/**';
let enabled = false;
function getOverride() {
    return vscode.workspace.getConfiguration('null-cpp').get('projectDetection.override', 'auto');
}
async function hasAnyMatch(glob) {
    const matches = await vscode.workspace.findFiles(glob, EXCLUDE_GLOB, 1);
    return matches.length > 0;
}
async function scanWorkspace() {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        return false;
    }
    if (await hasAnyMatch(BUILD_CONFIG_GLOB)) {
        return true;
    }
    return hasAnyMatch(SOURCE_FILE_GLOB);
}
async function initializeProjectDetection() {
    const override = getOverride();
    if (override === 'always') {
        enabled = true;
    }
    else if (override === 'never') {
        enabled = false;
    }
    else {
        enabled = await scanWorkspace();
    }
    return enabled;
}
function isEnabled() {
    return enabled;
}
//# sourceMappingURL=projectDetection.js.map