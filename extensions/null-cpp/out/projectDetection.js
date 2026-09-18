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
exports.initializeProjectDetection = void 0;
exports.refreshProjectDetection = refreshProjectDetection;
exports.isEnabled = isEnabled;
const vscode = __importStar(require("vscode"));
const projectDetectionScan_1 = require("./projectDetectionScan");
let enabled = false;
function getOverride() {
    return vscode.workspace.getConfiguration('null-cpp').get('projectDetection.override', 'auto');
}
function scanWorkspace() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        // A file opened directly (without opening its containing folder) has no
        // workspace folder, but it is still a valid C/C++ editing context.
        const languageId = vscode.window.activeTextEditor?.document.languageId;
        return languageId === 'c' || languageId === 'cpp';
    }
    return folders.some(folder => (0, projectDetectionScan_1.scanDirectoryForCppProject)(folder.uri.fsPath));
}
async function refreshProjectDetection() {
    const override = getOverride();
    if (override === 'always') {
        enabled = true;
    }
    else if (override === 'never') {
        enabled = false;
    }
    else {
        enabled = scanWorkspace();
    }
    return enabled;
}
exports.initializeProjectDetection = refreshProjectDetection;
function isEnabled() {
    return enabled;
}
//# sourceMappingURL=projectDetection.js.map