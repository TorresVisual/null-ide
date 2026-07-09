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
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const recentProjects_1 = require("./recentProjects");
(0, node_test_1.test)('upsertEntry adds a new entry to the front', () => {
    const result = (0, recentProjects_1.upsertEntry)([], { path: 'C:\\Projects\\Foo', label: 'Foo', isWorkspaceFile: false });
    assert.equal(result.length, 1);
    assert.equal(result[0].path, 'C:\\Projects\\Foo');
    assert.equal(result[0].label, 'Foo');
});
(0, node_test_1.test)('upsertEntry moves an existing entry (case-insensitive) to the front instead of duplicating', () => {
    const existing = [
        { path: 'C:\\Projects\\Foo', label: 'Foo', isWorkspaceFile: false, timestamp: 1 },
        { path: 'C:\\Projects\\Bar', label: 'Bar', isWorkspaceFile: false, timestamp: 2 },
    ];
    const result = (0, recentProjects_1.upsertEntry)(existing, { path: 'c:\\projects\\foo', label: 'Foo', isWorkspaceFile: false });
    assert.equal(result.length, 2);
    assert.equal(result[0].path, 'c:\\projects\\foo');
    assert.equal(result[1].path, 'C:\\Projects\\Bar');
});
(0, node_test_1.test)('upsertEntry truncates to maxEntries', () => {
    const existing = Array.from({ length: 5 }, (_, i) => ({
        path: `C:\\Projects\\P${i}`, label: `P${i}`, isWorkspaceFile: false, timestamp: i,
    }));
    const result = (0, recentProjects_1.upsertEntry)(existing, { path: 'C:\\Projects\\New', label: 'New', isWorkspaceFile: false }, 3);
    assert.equal(result.length, 3);
    assert.equal(result[0].path, 'C:\\Projects\\New');
});
(0, node_test_1.test)('readRecentProjects returns [] for a missing file', () => {
    const missing = path.join(os.tmpdir(), `null-recent-projects-missing-${process.pid}.json`);
    assert.deepEqual((0, recentProjects_1.readRecentProjects)(missing), []);
});
(0, node_test_1.test)('readRecentProjects returns [] for corrupt JSON', () => {
    const filePath = path.join(os.tmpdir(), `null-recent-projects-corrupt-${process.pid}.json`);
    fs.writeFileSync(filePath, '{not valid json');
    try {
        assert.deepEqual((0, recentProjects_1.readRecentProjects)(filePath), []);
    }
    finally {
        fs.unlinkSync(filePath);
    }
});
(0, node_test_1.test)('writeRecentProjectsAtomic then readRecentProjects round-trips entries', () => {
    const filePath = path.join(os.tmpdir(), `null-recent-projects-roundtrip-${process.pid}.json`);
    const entries = [
        { path: 'C:\\Projects\\Foo', label: 'Foo', isWorkspaceFile: false, timestamp: 123 },
    ];
    try {
        (0, recentProjects_1.writeRecentProjectsAtomic)(filePath, entries);
        assert.deepEqual((0, recentProjects_1.readRecentProjects)(filePath), entries);
    }
    finally {
        fs.unlinkSync(filePath);
    }
});
//# sourceMappingURL=recentProjects.test.js.map