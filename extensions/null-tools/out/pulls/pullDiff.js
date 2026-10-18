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
exports.pullDocUri = pullDocUri;
exports.sideUri = sideUri;
exports.openPullFileDiff = openPullFileDiff;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const graphDiff_1 = require("../graph/graphDiff");
const pullDocs_1 = require("./pullDocs");
const pullModel_1 = require("./pullModel");
function pullDocUri(ref) {
    return vscode.Uri.from({ scheme: pullDocs_1.PULL_SCHEME, path: `/${ref.path}`, query: (0, pullDocs_1.docQuery)(ref) });
}
/** The document for one side of `filePath`. Diffs and comment threads both build their URIs here, so they always match. */
function sideUri(detail, filePath, side) {
    return pullDocUri({
        ...detail.repo,
        pull: detail.pull.number,
        path: side === 'LEFT' ? (0, pullModel_1.leftPath)(detail.files, filePath) : filePath,
        sha: side === 'LEFT' ? detail.mergeBase : detail.pull.headSha,
        head: detail.pull.headSha,
        side,
    });
}
async function openPullFileDiff(detail, file) {
    const left = file.status === 'added' ? (0, graphDiff_1.emptyDocUri)(file.path) : sideUri(detail, file.path, 'LEFT');
    const right = file.status === 'removed' ? (0, graphDiff_1.emptyDocUri)(file.path) : sideUri(detail, file.path, 'RIGHT');
    await vscode.commands.executeCommand('vscode.diff', left, right, `${path.basename(file.path)} (#${detail.pull.number})`);
}
//# sourceMappingURL=pullDiff.js.map