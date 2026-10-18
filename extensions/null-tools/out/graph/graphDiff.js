/// <reference path="./protocol.ts" />
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
exports.registerEmptyDocument = registerEmptyDocument;
exports.emptyDocUri = emptyDocUri;
exports.openFileDiff = openFileDiff;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const gitApi_1 = require("./gitApi");
const EMPTY_SCHEME = 'null-graph-empty';
/** Serves an empty document for the missing side of an added, deleted or root-commit diff. */
function registerEmptyDocument(context) {
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(EMPTY_SCHEME, { provideTextDocumentContent: () => '' }));
}
/** URI of the empty document standing in for the missing side of an added or deleted file. */
function emptyDocUri(filePath) {
    return vscode.Uri.from({ scheme: EMPTY_SCHEME, path: `/${filePath}` });
}
/** Opens a native diff of `file` between `parent` and `sha` (no parent = root commit). */
async function openFileDiff(root, sha, parent, file) {
    const api = await (0, gitApi_1.getGitApi)();
    const empty = emptyDocUri(file.path);
    const left = !parent || file.status === 'A'
        ? empty
        : api.toGitUri(vscode.Uri.file(path.join(root, file.oldPath ?? file.path)), parent);
    const right = file.status === 'D' ? empty : api.toGitUri(vscode.Uri.file(path.join(root, file.path)), sha);
    const title = `${path.basename(file.path)} (${parent ? parent.slice(0, 7) : 'empty'} ↔ ${sha.slice(0, 7)})`;
    await vscode.commands.executeCommand('vscode.diff', left, right, title);
}
//# sourceMappingURL=graphDiff.js.map