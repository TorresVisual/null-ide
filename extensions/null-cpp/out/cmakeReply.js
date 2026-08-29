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
exports.wrapWslCommand = wrapWslCommand;
exports.pickLatestIndexFile = pickLatestIndexFile;
exports.parseReplyIndex = parseReplyIndex;
exports.parseCodemodelTargets = parseCodemodelTargets;
exports.parseTargetDetail = parseTargetDetail;
const path = __importStar(require("node:path"));
function wrapWslCommand(command, args, distro) {
    return { command: 'wsl.exe', args: ['-d', distro, '--', command, ...args] };
}
/** Picks the newest `index-*.json` reply file — CMake's timestamped names sort chronologically as strings. */
function pickLatestIndexFile(fileNames) {
    const indexFiles = fileNames.filter((f) => /^index-.*\.json$/.test(f)).sort();
    return indexFiles.length > 0 ? indexFiles[indexFiles.length - 1] : undefined;
}
function parseReplyIndex(indexJson) {
    const entry = indexJson?.reply?.['codemodel-v2'];
    if (!entry || 'error' in entry || typeof entry.jsonFile !== 'string') {
        return undefined;
    }
    return { kind: entry.kind ?? 'codemodel', jsonFile: entry.jsonFile };
}
function parseCodemodelTargets(codemodelJson, configName) {
    const configs = codemodelJson?.configurations ?? [];
    const config = configName ? configs.find((c) => c.name === configName) : configs[0];
    return config?.targets ?? [];
}
/** Artifact paths in the File API are relative to the top-level build directory; source paths to the top-level source directory. */
function parseTargetDetail(name, json, binaryDir) {
    const detail = json ?? {};
    const artifactRel = detail.artifacts?.[0]?.path;
    return {
        name,
        type: detail.type ?? 'UTILITY',
        artifactPath: artifactRel ? path.join(binaryDir, ...artifactRel.split('/')) : '',
        sourceFiles: (detail.sources ?? []).map((s) => s.path),
    };
}
//# sourceMappingURL=cmakeReply.js.map