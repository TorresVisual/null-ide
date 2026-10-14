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
exports.enablePrompts = exports.describeCategory = void 0;
exports.chooseConflictAction = chooseConflictAction;
exports.chooseRevision = chooseRevision;
exports.confirmRestore = confirmRestore;
exports.confirmStop = confirmStop;
const vscode = __importStar(require("vscode"));
const cryptoBox_1 = require("./cryptoBox");
const secret = (options) => vscode.window.showInputBox({ password: true, ignoreFocusOut: true, ...options });
/** What the user is agreeing to upload, in words (the setting name alone says little for `activity`). */
const describeCategory = (category) => category === 'activity' ? 'coding activity history (project names, file paths, languages and times)' : category;
exports.describeCategory = describeCategory;
exports.enablePrompts = {
    async chooseAccount(accounts) {
        const picked = await vscode.window.showQuickPick(accounts.map((account) => ({ label: `@${account.username}`, account })), { placeHolder: 'Sync settings with which GitHub account?' });
        return picked?.account;
    },
    async consent(categories) {
        const answer = await vscode.window.showWarningMessage(`Upload your ${categories.map(exports.describeCategory).join(', ')} to a secret GitHub Gist? They are encrypted on this device with a passphrase you choose, so only someone who knows it can read them. The passphrase cannot be recovered or reset.`, { modal: true }, 'Enable Sync');
        return answer === 'Enable Sync';
    },
    async newPassphrase() {
        const first = await secret({
            title: 'Null Sync: choose a passphrase',
            prompt: 'At least 12 characters. It cannot be recovered or reset, and you will enter it once on each device.',
            validateInput: (value) => (0, cryptoBox_1.passphraseProblem)(value, value),
        });
        if (first === undefined)
            return undefined;
        const second = await secret({
            title: 'Null Sync: confirm the passphrase',
            prompt: 'Enter it again.',
            validateInput: (value) => (0, cryptoBox_1.passphraseProblem)(first, value),
        });
        return second === undefined ? undefined : first;
    },
    existingPassphrase: (attempt) => Promise.resolve(secret({
        title: 'Null Sync: enter your passphrase',
        prompt: attempt === 1
            ? 'This account already has synced settings. Enter the passphrase you chose on your first device.'
            : 'That was not the right passphrase. Try again.',
    })),
    async firstSync() {
        const picked = await vscode.window.showQuickPick([
            { label: 'Use the synced settings', description: 'Replace this device\'s files; your versions are backed up', value: 'cloud' },
            { label: 'Use this device\'s settings', description: 'Replace the synced files with this device\'s', value: 'device' },
            { label: 'Decide file by file', description: 'Keep both for now and resolve each difference yourself', value: 'each' },
        ], { placeHolder: 'This device already has settings. How should they be combined with the synced ones?', ignoreFocusOut: true });
        return picked?.value;
    },
};
async function chooseConflictAction(file) {
    const picked = await vscode.window.showQuickPick([
        { label: 'Keep mine', description: 'Upload this device\'s version', value: 'mine' },
        { label: 'Take theirs', description: 'Use the synced version; yours is backed up', value: 'theirs' },
        { label: 'Show diff', description: 'Compare the two first', value: 'diff' },
    ], { placeHolder: `${file} changed on this device and on another one`, ignoreFocusOut: true });
    return picked?.value;
}
async function chooseRevision(revisions) {
    const picked = await vscode.window.showQuickPick(revisions.map((revision) => ({ label: new Date(revision.date).toLocaleString(), description: revision.sha.slice(0, 7), revision })), { placeHolder: 'Restore the synced settings as they were at…' });
    return picked?.revision;
}
async function confirmRestore(revision) {
    const answer = await vscode.window.showWarningMessage(`Restore the synced settings from ${new Date(revision.date).toLocaleString()}? This device and every synced device will switch to that version. The current files are backed up on this device first.`, { modal: true }, 'Restore');
    return answer === 'Restore';
}
async function confirmStop() {
    const answer = await vscode.window.showWarningMessage('Stop syncing on this device? Your local files are not changed.', { modal: true }, 'Stop Syncing', 'Stop and Delete the Synced Copy');
    return answer === 'Stop Syncing' ? 'stop' : answer === 'Stop and Delete the Synced Copy' ? 'delete' : undefined;
}
//# sourceMappingURL=prompts.js.map