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
exports.VscodeTerminalHost = void 0;
const vscode = __importStar(require("vscode"));
// Shell integration attaches a moment after a terminal's shell starts. Only
// terminals we just created are worth waiting for; one that still has none
// later (cmd.exe, unsupported shell) must not delay every click.
const INTEGRATION_WAIT_MS = 3000;
class VscodeTerminalHost {
    createdAt = new WeakMap();
    listTerminals() {
        return [...vscode.window.terminals];
    }
    createTerminal(options) {
        const terminal = vscode.window.createTerminal({ name: options.name, cwd: options.cwd });
        this.createdAt.set(terminal, Date.now());
        return terminal;
    }
    async execute(handle, command) {
        const terminal = handle;
        const integration = terminal.shellIntegration ?? (await this.waitForIntegration(terminal));
        if (!integration) {
            return undefined;
        }
        const execution = integration.executeCommand(command);
        const exitCode = new Promise(resolve => {
            const end = vscode.window.onDidEndTerminalShellExecution(e => {
                if (e.execution === execution) {
                    done(e.exitCode);
                }
            });
            const close = vscode.window.onDidCloseTerminal(t => {
                if (t === terminal) {
                    done(undefined);
                }
            });
            function done(code) {
                end.dispose();
                close.dispose();
                resolve(code);
            }
        });
        return { exitCode };
    }
    waitForIntegration(terminal) {
        const remaining = INTEGRATION_WAIT_MS - (Date.now() - (this.createdAt.get(terminal) ?? 0));
        if (remaining <= 0) {
            return Promise.resolve(undefined);
        }
        return new Promise(resolve => {
            const sub = vscode.window.onDidChangeTerminalShellIntegration(e => {
                if (e.terminal === terminal) {
                    finish(e.shellIntegration);
                }
            });
            const timer = setTimeout(() => finish(undefined), remaining);
            function finish(si) {
                clearTimeout(timer);
                sub.dispose();
                resolve(si);
            }
        });
    }
}
exports.VscodeTerminalHost = VscodeTerminalHost;
//# sourceMappingURL=terminalHostIntegration.js.map