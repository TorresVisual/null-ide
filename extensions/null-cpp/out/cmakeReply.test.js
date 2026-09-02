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
const cmakeReply_1 = require("./cmakeReply");
(0, node_test_1.test)('wrapWslCommand wraps the command through wsl.exe -d <distro> --', () => {
    const wrapped = (0, cmakeReply_1.wrapWslCommand)('cmake', ['--build', '.'], 'Ubuntu');
    assert.equal(wrapped.command, 'wsl.exe');
    assert.deepEqual(wrapped.args, ['-d', 'Ubuntu', '--', 'cmake', '--build', '.']);
});
(0, node_test_1.test)('wrapWslCommand sets an explicit --cd when a posix cwd is given', () => {
    const wrapped = (0, cmakeReply_1.wrapWslCommand)('cmake', ['--build', '.'], 'Ubuntu', '/mnt/d/proj');
    assert.deepEqual(wrapped.args, ['-d', 'Ubuntu', '--cd', '/mnt/d/proj', '--', 'cmake', '--build', '.']);
});
(0, node_test_1.test)('pickLatestIndexFile picks the lexicographically-last index-*.json', () => {
    const files = [
        'index-2024-01-01T00-00-00-0000.json',
        'index-2024-06-01T00-00-00-0000.json',
        'codemodel-v2-abc.json',
    ];
    assert.equal((0, cmakeReply_1.pickLatestIndexFile)(files), 'index-2024-06-01T00-00-00-0000.json');
});
(0, node_test_1.test)('pickLatestIndexFile returns undefined when no index file exists', () => {
    assert.equal((0, cmakeReply_1.pickLatestIndexFile)(['codemodel-v2-abc.json']), undefined);
});
(0, node_test_1.test)('parseReplyIndex extracts the codemodel-v2 jsonFile reference', () => {
    const index = {
        reply: {
            'codemodel-v2': { kind: 'codemodel', version: { major: 2, minor: 8 }, jsonFile: 'codemodel-v2-abc.json' },
        },
    };
    assert.deepEqual((0, cmakeReply_1.parseReplyIndex)(index), { kind: 'codemodel', jsonFile: 'codemodel-v2-abc.json' });
});
(0, node_test_1.test)('parseReplyIndex returns undefined when the query errored or is missing', () => {
    assert.equal((0, cmakeReply_1.parseReplyIndex)({ reply: { 'codemodel-v2': { error: 'unknown query file' } } }), undefined);
    assert.equal((0, cmakeReply_1.parseReplyIndex)({ reply: {} }), undefined);
    assert.equal((0, cmakeReply_1.parseReplyIndex)({}), undefined);
});
(0, node_test_1.test)('parseCodemodelTargets returns the first configuration by default', () => {
    const codemodel = {
        configurations: [
            { name: 'Debug', targets: [{ name: 'app', jsonFile: 'target-app-Debug.json' }] },
            { name: 'Release', targets: [{ name: 'app', jsonFile: 'target-app-Release.json' }] },
        ],
    };
    assert.deepEqual((0, cmakeReply_1.parseCodemodelTargets)(codemodel), [{ name: 'app', jsonFile: 'target-app-Debug.json' }]);
});
(0, node_test_1.test)('parseCodemodelTargets can select a named configuration', () => {
    const codemodel = {
        configurations: [
            { name: 'Debug', targets: [{ name: 'app', jsonFile: 'target-app-Debug.json' }] },
            { name: 'Release', targets: [{ name: 'app', jsonFile: 'target-app-Release.json' }] },
        ],
    };
    assert.deepEqual((0, cmakeReply_1.parseCodemodelTargets)(codemodel, 'Release'), [{ name: 'app', jsonFile: 'target-app-Release.json' }]);
});
(0, node_test_1.test)('parseTargetDetail resolves the artifact path against the binary directory', () => {
    const detail = {
        type: 'EXECUTABLE',
        artifacts: [{ path: 'Debug/app.exe' }],
        sources: [{ path: 'src/main.cpp' }],
    };
    const target = (0, cmakeReply_1.parseTargetDetail)('app', detail, 'C:\\proj\\build');
    assert.equal(target.name, 'app');
    assert.equal(target.type, 'EXECUTABLE');
    assert.equal(target.artifactPath, 'C:\\proj\\build\\Debug\\app.exe');
    assert.deepEqual(target.sourceFiles, ['src/main.cpp']);
});
(0, node_test_1.test)('parseTargetDetail defaults an artifact-less target (e.g. a UTILITY) to an empty artifactPath', () => {
    const target = (0, cmakeReply_1.parseTargetDetail)('docs', {}, 'C:\\proj\\build');
    assert.equal(target.type, 'UTILITY');
    assert.equal(target.artifactPath, '');
    assert.deepEqual(target.sourceFiles, []);
});
//# sourceMappingURL=cmakeReply.test.js.map