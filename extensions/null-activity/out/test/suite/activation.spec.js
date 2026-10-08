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
const assert = __importStar(require("assert"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
suite('null-activity', () => {
    test('activates, exports the API and registers the privacy commands', async () => {
        const api = await vscode.extensions.getExtension('null.null-activity').activate();
        assert.strictEqual(typeof api.getIntervals, 'function');
        assert.strictEqual('deleteAll' in api, false, 'deletion must not be part of the public API');
        const commands = await vscode.commands.getCommands(true);
        for (const id of ['null-activity.showTrackedData', 'null-activity.deleteRange', 'null-activity.deleteAll']) {
            assert.ok(commands.includes(id), `${id} not registered`);
        }
    });
    test('editing a file records an interval that the tracked-data report reflects', async function () {
        this.timeout(30_000);
        if (!vscode.window.state.focused)
            this.skip(); // heartbeats only count while the window is focused
        const api = await vscode.extensions.getExtension('null.null-activity').activate();
        const file = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'activity-spec.txt');
        fs.writeFileSync(file, '');
        const before = Date.now();
        const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
        await editor.edit((b) => b.insert(new vscode.Position(0, 0), 'hello\n'));
        await sleep(200);
        await editor.edit((b) => b.insert(new vscode.Position(0, 0), 'world\n'));
        const mine = api
            .getIntervals({ from: before - 60_000, to: Date.now() + 60_000 })
            .filter((i) => i.file === 'activity-spec.txt');
        assert.ok(mine.length > 0, 'no interval recorded for the edited file');
        assert.ok(mine.every((i) => i.end > i.start));
        assert.strictEqual(mine[0].language, 'plaintext');
        assert.ok(mine.reduce((n, i) => n + i.linesAdded, 0) >= 2, 'expected the two inserted lines to be counted');
        await vscode.commands.executeCommand('null-activity.showTrackedData');
        const doc = vscode.window.activeTextEditor.document;
        assert.strictEqual(doc.uri.scheme, 'null-activity');
        assert.ok(doc.getText().includes('Totals by month'));
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });
});
//# sourceMappingURL=activation.spec.js.map