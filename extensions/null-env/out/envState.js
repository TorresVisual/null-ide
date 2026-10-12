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
exports.EnvState = void 0;
const vscode = __importStar(require("vscode"));
const check_1 = require("./check");
const detect_1 = require("./detect");
const SNOOZE_KEY = 'null-env.snoozedSignature';
/** The current findings for the open workspace folders, plus the per-workspace snooze of the status bar warning. */
class EnvState {
    probes;
    memento;
    findings = [];
    emitter = new vscode.EventEmitter();
    onDidChange = this.emitter.event;
    constructor(probes, memento) {
        this.probes = probes;
        this.memento = memento;
    }
    get() {
        return this.findings;
    }
    /** Required findings to warn about right now (none while snoozed). */
    warnings() {
        return (0, check_1.visibleRequired)(this.findings, this.memento.get(SNOOZE_KEY));
    }
    snooze() {
        return this.memento.update(SNOOZE_KEY, (0, check_1.requiredSignature)(this.findings)).then(() => this.emitter.fire());
    }
    refresh() {
        const languages = new Set();
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            for (const language of (0, detect_1.detectLanguages)(folder.uri.fsPath)) {
                languages.add(language);
            }
        }
        const next = (0, check_1.check)([...languages], this.probes);
        if (JSON.stringify(next) !== JSON.stringify(this.findings)) {
            this.findings = next;
            this.emitter.fire();
        }
    }
    dispose() {
        this.emitter.dispose();
    }
}
exports.EnvState = EnvState;
//# sourceMappingURL=envState.js.map