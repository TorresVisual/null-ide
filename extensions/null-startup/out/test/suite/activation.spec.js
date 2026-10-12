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
const vscode = __importStar(require("vscode"));
// The integration runner uses a vanilla VS Code build, which has no patch 010, so this spec covers
// the degradation path: the extension stays active and quiet, and the report tab still opens.
suite('null-startup', () => {
    test('activates, registers its commands, and copies nothing on a build without the snapshot command', async function () {
        this.timeout(30_000);
        await vscode.extensions.getExtension('null.null-startup').activate();
        const commands = await vscode.commands.getCommands(true);
        for (const id of ['null-startup.openReport', 'null-startup.copyReport', 'null-startup.exportReport', 'null-startup.clearHistory']) {
            assert.ok(commands.includes(id), `${id} registered`);
        }
        await vscode.commands.executeCommand('null-startup.openReport');
        await vscode.commands.executeCommand('null-startup.copyReport');
        assert.strictEqual((await vscode.env.clipboard.readText()).includes('Null IDE startup report'), false);
    });
});
//# sourceMappingURL=activation.spec.js.map