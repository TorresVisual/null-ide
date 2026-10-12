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
exports.registerRecoveryFeature = registerRecoveryFeature;
const vscode = __importStar(require("vscode"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const followAlong_1 = require("../followAlong");
const crashMarker_1 = require("./crashMarker");
const interruptedSessions_1 = require("./interruptedSessions");
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const CLAUDE_EXTENSION = 'anthropic.claude-code';
const OPEN_SESSION_COMMAND = 'claude-vscode.editor.open';
function collectSessions(found, windowFolders, until) {
    const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
    const byId = new Map();
    for (const { marker } of found) {
        for (const folder of marker.folders.filter(f => (0, crashMarker_1.sharesFolder)([f], windowFolders))) {
            const projectDir = (0, followAlong_1.findProjectDir)(claudeProjectsDir, folder);
            if (!projectDir)
                continue;
            for (const s of (0, interruptedSessions_1.scanSessions)(projectDir, marker.startedAt, until))
                byId.set(s.sessionId, s);
        }
    }
    return [...byId.values()].sort((a, b) => b.lastActivity - a.lastActivity);
}
function toItem(session) {
    return {
        label: session.title,
        description: new Date(session.lastActivity).toLocaleString(),
        detail: session.interrupted
            ? 'Interrupted mid-turn — the conversation is restored, the operation was not resumed'
            : 'Completed before the exit',
        iconPath: new vscode.ThemeIcon(session.interrupted ? 'warning' : 'comment-discussion'),
        session,
    };
}
async function review(found, windowFolders, until) {
    const drop = () => found.forEach(f => (0, crashMarker_1.removeMarker)(f.file));
    // Nothing to offer without the Claude Code extension or any session from the crashed run.
    if (!vscode.extensions.getExtension(CLAUDE_EXTENSION))
        return drop();
    const sessions = collectSessions(found, windowFolders, until);
    if (!sessions.length)
        return drop();
    const interrupted = sessions.filter(s => s.interrupted).length;
    const noun = sessions.length === 1 ? 'conversation was' : 'conversations were';
    const tail = interrupted ? ` (${interrupted} interrupted mid-turn)` : '';
    const choice = await vscode.window.showWarningMessage(`Null IDE closed unexpectedly. Unsaved editors were restored by VS Code. ${sessions.length} Claude ${noun} open${tail}.`, 'Review', 'Later', 'Discard');
    if (choice === 'Discard')
        return drop();
    if (choice !== 'Review')
        return; // Later, or the toast was dismissed: ask again next launch
    let remaining = sessions;
    while (remaining.length) {
        const pick = await vscode.window.showQuickPick(remaining.map(toItem), {
            placeHolder: 'Open a Claude conversation from before the exit',
        });
        if (!pick)
            return; // left early: keep the rest pending
        await vscode.commands.executeCommand(OPEN_SESSION_COMMAND, pick.session.sessionId);
        remaining = remaining.filter(s => s !== pick.session);
    }
    drop();
}
function registerRecoveryFeature(context) {
    if (!vscode.workspace.getConfiguration('null.recovery').get('enabled', true))
        return;
    try {
        const dir = path.join(context.globalStorageUri.fsPath, 'recovery');
        const startedAt = Date.now();
        const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
        // Scan before writing our own marker so we never see ourselves.
        const relevant = [];
        for (const crashed of (0, crashMarker_1.findCrashed)(dir, crashMarker_1.isPidAlive, startedAt, MAX_AGE_MS)) {
            if (crashed.marker.folders.length === 0)
                (0, crashMarker_1.removeMarker)(crashed.file); // nothing to review
            else if ((0, crashMarker_1.sharesFolder)(crashed.marker.folders, folders))
                relevant.push(crashed);
        }
        const file = (0, crashMarker_1.writeMarker)(dir, { pid: process.pid, startedAt, folders });
        context.subscriptions.push({ dispose: () => (0, crashMarker_1.removeMarker)(file) });
        if (relevant.length) {
            review(relevant, folders, startedAt).catch(err => console.error('[null-recovery]', err));
        }
    }
    catch (err) {
        console.error('[null-recovery]', err);
    }
}
//# sourceMappingURL=recoveryIntegration.js.map