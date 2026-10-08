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
const recentProjects_1 = require("./recentProjects");
function withStore(run) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-recent-projects-'));
    try {
        run(path.join(dir, 'recent.json'), dir);
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
(0, node_test_1.test)('legacy entries receive defaults and unknown members are ignored', () => withStore(file => {
    fs.writeFileSync(file, JSON.stringify([
        { path: 'C:\\Code\\App', label: 'App', isWorkspaceFile: false, timestamp: 7 },
        { path: 42 },
    ]));
    assert.deepEqual((0, recentProjects_1.readRecentProjects)(file), [{
            path: 'C:\\Code\\App', label: 'App', isWorkspaceFile: false, timestamp: 7, pinned: false,
        }]);
}));
(0, node_test_1.test)('readRecentProjects treats missing and malformed data as empty', () => withStore(file => {
    assert.deepEqual((0, recentProjects_1.readRecentProjects)(file), []);
    fs.writeFileSync(file, '{not valid json');
    assert.deepEqual((0, recentProjects_1.readRecentProjects)(file), []);
    fs.writeFileSync(file, JSON.stringify({ not: 'an array' }));
    assert.deepEqual((0, recentProjects_1.readRecentProjects)(file), []);
}));
(0, node_test_1.test)('retention drops only oldest unpinned entries', () => withStore(file => {
    (0, recentProjects_1.writeRecentProjects)(file, [
        { path: 'C:\\pinned', label: 'Pinned', isWorkspaceFile: false, timestamp: 1, pinned: true },
        { path: 'C:\\middle', label: 'Middle', isWorkspaceFile: false, timestamp: 2, pinned: false },
        { path: 'C:\\newest', label: 'Newest', isWorkspaceFile: false, timestamp: 3, pinned: false },
        { path: 'C:\\oldest', label: 'Oldest', isWorkspaceFile: false, timestamp: 0, pinned: false },
    ]);
    assert.equal((0, recentProjects_1.updateRecentProjects)(file, entries => entries, 2), true);
    assert.deepEqual((0, recentProjects_1.readRecentProjects)(file).map(({ label }) => label), ['Newest', 'Middle', 'Pinned']);
}));
(0, node_test_1.test)('touch preserves enhanced fields and deduplicates case variants', () => withStore(file => {
    (0, recentProjects_1.writeRecentProjects)(file, [{
            path: 'C:\\Code\\App', label: 'Old', isWorkspaceFile: false, timestamp: 1, pinned: true,
            gitBranch: 'main', projectType: 'Node', icon: 'node',
        }]);
    assert.equal((0, recentProjects_1.touchRecentProject)(file, {
        path: 'c:\\code\\app', label: 'App', isWorkspaceFile: false, pinned: false,
    }, 20), true);
    const [entry] = (0, recentProjects_1.readRecentProjects)(file);
    assert.equal((0, recentProjects_1.readRecentProjects)(file).length, 1);
    assert.deepEqual({ path: entry.path, label: entry.label, pinned: entry.pinned, gitBranch: entry.gitBranch, projectType: entry.projectType, icon: entry.icon }, { path: 'c:\\code\\app', label: 'App', pinned: true, gitBranch: 'main', projectType: 'Node', icon: 'node' });
}));
(0, node_test_1.test)('pin and removal affect only the selected normalized identity', () => withStore(file => {
    (0, recentProjects_1.writeRecentProjects)(file, [
        { path: 'C:\\one', label: 'One', isWorkspaceFile: false, timestamp: 2, pinned: false },
        { path: 'C:\\two', label: 'Two', isWorkspaceFile: false, timestamp: 1, pinned: false },
    ]);
    assert.equal((0, recentProjects_1.setRecentProjectPinned)(file, 'c:\\one', true, 20), true);
    assert.equal((0, recentProjects_1.removeRecentProject)(file, 'C:\\two', 20), true);
    assert.deepEqual((0, recentProjects_1.readRecentProjects)(file).map(entry => [entry.label, entry.pinned]), [['One', true]]);
}));
(0, node_test_1.test)('writes atomically without leaving a temporary file', () => withStore((file, dir) => {
    assert.equal((0, recentProjects_1.writeRecentProjects)(file, [{ path: 'C:\\App', label: 'App', isWorkspaceFile: false, timestamp: 1, pinned: false }]), true);
    assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')), []);
}));
//# sourceMappingURL=recentProjects.test.js.map