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
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
suite('null-activity WakaTime import', () => {
    test('importing a small export adds its time through the API, and a non-export is rejected without touching data', async function () {
        this.timeout(30_000);
        const api = await vscode.extensions.getExtension('null.null-activity').activate();
        assert.ok((await vscode.commands.getCommands(true)).includes('null-activity.importWakaTime'));
        const base = Date.UTC(2001, 0, 2, 12) / 1000;
        const heartbeats = [0, 60, 120].map((s) => ({
            time: base + s, project: 'fixture-project', language: 'TypeScript', entity: '/nonexistent/fixture-project/src/a.ts', type: 'file',
        }));
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-waka-spec-'));
        const good = path.join(dir, 'export.json');
        const bad = path.join(dir, 'not-an-export.json');
        fs.writeFileSync(good, JSON.stringify({ user: { timeout: 15 }, range: {}, days: [{ date: '2001-01-02', heartbeats }] }));
        fs.writeFileSync(bad, JSON.stringify({ hello: 'world' }));
        const window = { from: base * 1000 - 3_600_000, to: base * 1000 + 3_600_000 };
        try {
            await vscode.commands.executeCommand('null-activity.importWakaTime', vscode.Uri.file(bad));
            assert.deepStrictEqual(api.getIntervals(window), [], 'a rejected file must not add data');
            await vscode.commands.executeCommand('null-activity.importWakaTime', vscode.Uri.file(good));
            const got = api.getIntervals(window).map((i) => [i.project.name, i.language, i.file, i.end - i.start]);
            assert.deepStrictEqual(got, [['fixture-project', 'typescript', 'a.ts', 120_000]]);
            await vscode.commands.executeCommand('null-activity.importWakaTime', vscode.Uri.file(good));
            assert.strictEqual(api.getIntervals(window).length, 1, 're-importing replaces instead of duplicating');
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=import.spec.js.map