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
const node_test_1 = require("node:test");
const assert = __importStar(require("node:assert/strict"));
const exportFormat_1 = require("./exportFormat");
const doc = (over = {}) => ({
    schema: 1, engineVersion: '5.8.4', sourceMtime: 1, sourceSize: 2, package: '/Game/T', kind: 'texture', class: 'Texture2D',
    references: { dependencies: [] }, data: { width: 4, height: 2, compression: 'TC_MASKS' }, sidecars: {}, ...over,
});
(0, node_test_1.test)('a well-formed export parses', () => {
    assert.equal((0, exportFormat_1.parseExport)(JSON.stringify(doc()))?.package, '/Game/T');
});
(0, node_test_1.test)('unparseable, truncated and wrong-shaped exports are rejected, never thrown', () => {
    assert.equal((0, exportFormat_1.parseExport)('{"schema":1,"engi'), undefined);
    assert.equal((0, exportFormat_1.parseExport)('[]'), undefined);
    assert.equal((0, exportFormat_1.parseExport)(JSON.stringify(doc({ kind: 'blueprint' }))), undefined);
    assert.equal((0, exportFormat_1.parseExport)(JSON.stringify(doc({ sourceMtime: 'x' }))), undefined);
    assert.equal((0, exportFormat_1.parseExport)(JSON.stringify(doc({ references: {} }))), undefined);
});
(0, node_test_1.test)('a manifest maps each package to its status', () => {
    const m = (0, exportFormat_1.parseManifest)(JSON.stringify({ schema: 1, assets: { '/Game/A': { status: 'exported' }, '/Game/B': { status: 'failed', error: 'boom' } } }));
    assert.deepEqual(m, { '/Game/A': { status: 'exported' }, '/Game/B': { status: 'failed', error: 'boom' } });
});
(0, node_test_1.test)('a manifest with an unknown status or a broken file is rejected', () => {
    assert.equal((0, exportFormat_1.parseManifest)(JSON.stringify({ assets: { '/Game/A': { status: 'maybe' } } })), undefined);
    assert.equal((0, exportFormat_1.parseManifest)('{"assets":'), undefined);
});
(0, node_test_1.test)('summarize gives one line per kind', () => {
    const d = (kind, data) => (0, exportFormat_1.parseExport)(JSON.stringify(doc({ kind, data })));
    assert.equal((0, exportFormat_1.summarize)(d('material', { expressions: [1, 2, 3], parameters: [1] })), 'Material, 3 expressions, 1 parameters');
    assert.equal((0, exportFormat_1.summarize)(d('texture', { width: 4, height: 2, compression: 'TC_MASKS' })), 'Texture 4x2, TC_MASKS');
    assert.equal((0, exportFormat_1.summarize)(d('skeletal-mesh', { bones: [1, 2], lods: [1] })), 'Skeletal mesh, 2 bones, 1 LODs');
    assert.equal((0, exportFormat_1.summarize)(d('material-instance', { parent: '/Game/M' })), 'Material instance of /Game/M');
    assert.equal((0, exportFormat_1.summarize)(d('generic', {})), 'Texture2D (generic export)');
});
//# sourceMappingURL=exportFormat.test.js.map