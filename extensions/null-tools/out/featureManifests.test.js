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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const node_test_1 = __importDefault(require("node:test"));
const featureRegistry_1 = require("./featureRegistry");
// out/ -> null-tools -> extensions
const extensionsDir = path.resolve(__dirname, '..', '..');
function readManifests() {
    return fs.readdirSync(extensionsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => path.join(extensionsDir, d.name, 'package.json'))
        .filter(p => fs.existsSync(p))
        .map(p => {
        const json = JSON.parse(fs.readFileSync(p, 'utf8'));
        return { extensionId: `${json.publisher}.${json.name}`, packageJSON: json };
    });
}
(0, node_test_1.default)('the real manifests declare exactly the agreed launcher entries', () => {
    const warnings = [];
    const result = (0, featureRegistry_1.collectFeatures)(readManifests(), m => warnings.push(m));
    node_assert_1.default.deepStrictEqual(warnings, []);
    node_assert_1.default.deepStrictEqual(result.map(c => [c.id, c.features.map(f => f.label)]), [
        ['develop', ['Dashboard', 'GitHub Issues', 'Pull Requests', 'GitHub Actions', 'Commit Graph', 'Music Player']],
        ['insights', ['Activity Dashboard', 'Startup Report']],
        ['account', ['Accounts', 'Sync Status']],
        ['setup', ['Null Setup', 'Environment Check', 'Actions Settings', 'Formatting Settings']],
    ]);
});
(0, node_test_1.default)('every launcher command is declared by some extension', () => {
    const manifests = readManifests();
    const declared = new Set();
    for (const { packageJSON } of manifests) {
        const commands = packageJSON.contributes?.commands ?? [];
        for (const c of commands) {
            declared.add(c.command);
        }
    }
    for (const category of (0, featureRegistry_1.collectFeatures)(manifests)) {
        for (const feature of category.features) {
            node_assert_1.default.ok(declared.has(feature.command), `${feature.key} runs undeclared command ${feature.command}`);
        }
    }
});
//# sourceMappingURL=featureManifests.test.js.map