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
const assert = __importStar(require("node:assert"));
const devcontainer_1 = require("./devcontainer");
const vars = { localWorkspaceFolder: 'D:/code/my proj', containerWorkspaceFolder: '/workspaces/my proj', env: { HOME: '/h' } };
(0, node_test_1.test)('parseConfig handles comments, trailing commas and slashes inside strings', () => {
    const cfg = (0, devcontainer_1.parseConfig)(`{
    // line
    "image": "host:8443/a/b:tag", /* block */
    "initializeCommand": "sh -c 'echo // not a comment, }'",
    "runArgs": ["--env-file", "x",],
  }`);
    assert.strictEqual(cfg.image, 'host:8443/a/b:tag');
    assert.strictEqual(cfg.initializeCommand, "sh -c 'echo // not a comment, }'");
    assert.deepStrictEqual(cfg.runArgs, ['--env-file', 'x']);
});
(0, node_test_1.test)('substitute', () => {
    assert.strictEqual((0, devcontainer_1.substitute)('${localWorkspaceFolder}/.devcontainer/.env', vars), 'D:/code/my proj/.devcontainer/.env');
    assert.strictEqual((0, devcontainer_1.substitute)('${localWorkspaceFolderBasename}:${localEnv:HOME}:${nope}', vars), 'my proj:/h:${nope}');
});
(0, node_test_1.test)('authority round-trips non-ascii paths', () => {
    const p = 'D:\\Cödé\\proj';
    assert.strictEqual((0, devcontainer_1.fromAuthority)((0, devcontainer_1.toAuthority)(p)), p);
});
(0, node_test_1.test)('containerFolder', () => {
    assert.strictEqual((0, devcontainer_1.containerFolder)({}, 'D:\\a\\proj'), '/workspaces/proj');
    assert.strictEqual((0, devcontainer_1.containerFolder)({ workspaceFolder: '/w/${localWorkspaceFolderBasename}' }, 'D:\\a\\proj'), '/w/proj');
});
(0, node_test_1.test)('buildRunArgs puts runArgs before the image and overrides the entrypoint', () => {
    const args = (0, devcontainer_1.buildRunArgs)({ image: 'img:1', runArgs: ['--env-file', '${localWorkspaceFolder}/.devcontainer/.env'], containerEnv: { A: 'b' } }, vars, 'n');
    assert.deepStrictEqual(args.slice(0, 4), ['run', '-d', '--name', 'n']);
    assert.ok(args.includes('D:/code/my proj/.devcontainer/.env'));
    assert.deepStrictEqual(args.slice(args.indexOf('--entrypoint')), ['--entrypoint', 'sh', 'img:1', '-c', 'while sleep 1000; do :; done']);
    assert.ok(args.indexOf('A=b') > 0);
});
(0, node_test_1.test)('archOf', () => {
    assert.strictEqual((0, devcontainer_1.archOf)('x86_64\n'), 'x64');
    assert.strictEqual((0, devcontainer_1.archOf)('aarch64\n'), 'arm64');
});
//# sourceMappingURL=devcontainer.test.js.map