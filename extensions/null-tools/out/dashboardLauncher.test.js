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
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const projectType_1 = require("./projectType");
const recentProjects_1 = require("./recentProjects");
function withStore(run) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-launcher-'));
    try {
        run(path.join(dir, 'recent.json'), dir);
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
const entry = (p, label, pinned = false) => ({ path: p, label, isWorkspaceFile: false, timestamp: 1, pinned });
(0, node_test_1.test)('findCurrentRecentProject accepts a case variant of a stored path', () => withStore(file => {
    (0, recentProjects_1.writeRecentProjects)(file, [entry('C:\Code\App', 'App')]);
    assert.equal((0, recentProjects_1.findCurrentRecentProject)(file, 'c:\code\app')?.label, 'App');
}));
(0, node_test_1.test)('findCurrentRecentProject rejects a stale path after its entry is removed', () => withStore(file => {
    (0, recentProjects_1.writeRecentProjects)(file, [entry('C:\Code\App', 'App'), entry('C:\Code\Other', 'Other')]);
    (0, recentProjects_1.removeRecentProject)(file, 'C:\Code\App', 20);
    assert.equal((0, recentProjects_1.findCurrentRecentProject)(file, 'C:\Code\App'), undefined);
    assert.equal((0, recentProjects_1.findCurrentRecentProject)(file, 'C:\Code\Other')?.label, 'Other');
}));
(0, node_test_1.test)('relocateRecentProject refuses a file and leaves the record untouched', () => withStore((file, dir) => {
    const notDir = path.join(dir, 'file.txt');
    fs.writeFileSync(notDir, 'x');
    (0, recentProjects_1.writeRecentProjects)(file, [entry('C:\Missing', 'Missing', true)]);
    assert.equal((0, recentProjects_1.relocateRecentProject)(file, 'C:\Missing', notDir, 20), false);
    assert.deepEqual((0, recentProjects_1.readRecentProjects)(file), [entry('C:\Missing', 'Missing', true)]);
}));
(0, node_test_1.test)('relocateRecentProject keeps pin state and takes the new folder name as label', () => withStore((file, dir) => {
    const target = path.join(dir, 'Relocated');
    fs.mkdirSync(target);
    (0, recentProjects_1.writeRecentProjects)(file, [entry('C:\Missing', 'Missing', true)]);
    assert.equal((0, recentProjects_1.relocateRecentProject)(file, 'C:\Missing', target, 20), true);
    assert.deepEqual((0, recentProjects_1.readRecentProjects)(file), [entry(target, 'Relocated', true)]);
}));
(0, node_test_1.test)('setRecentProjectPinned only flips the selected entry', () => withStore(file => {
    (0, recentProjects_1.writeRecentProjects)(file, [entry('C:\A', 'A'), entry('C:\B', 'B')]);
    (0, recentProjects_1.setRecentProjectPinned)(file, 'C:\B', true, 20);
    assert.deepEqual((0, recentProjects_1.readRecentProjects)(file).map(e => [e.label, e.pinned]), [['A', false], ['B', true]]);
}));
(0, node_test_1.test)('detectProjectType recognises Cargo, CMake, .NET, and Node roots and nothing else', () => withStore((_file, dir) => {
    const rust = path.join(dir, 'rust');
    fs.mkdirSync(rust);
    fs.writeFileSync(path.join(rust, 'Cargo.toml'), '');
    const node = path.join(dir, 'node');
    fs.mkdirSync(node);
    fs.writeFileSync(path.join(node, 'package.json'), '{}');
    const dotnet = path.join(dir, 'dotnet');
    fs.mkdirSync(dotnet);
    fs.writeFileSync(path.join(dotnet, 'App.csproj'), '');
    const plain = path.join(dir, 'plain');
    fs.mkdirSync(plain);
    assert.deepEqual((0, projectType_1.detectProjectType)(rust), { projectType: 'Rust', icon: 'rust' });
    assert.deepEqual((0, projectType_1.detectProjectType)(node), { projectType: 'Node', icon: 'node' });
    assert.deepEqual((0, projectType_1.detectProjectType)(dotnet), { projectType: '.NET', icon: 'dotnet' });
    assert.equal((0, projectType_1.detectProjectType)(plain), undefined);
    assert.equal((0, projectType_1.detectProjectType)(path.join(dir, 'does-not-exist')), undefined);
}));
//# sourceMappingURL=dashboardLauncher.test.js.map