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
(0, node_test_1.test)('readRecentProjects returns [] for non-array JSON', () => {
    const filePath = path.join(os.tmpdir(), `null-recent-projects-nonarray-${process.pid}.json`);
    fs.writeFileSync(filePath, '{"not": "an array"}');
    try {
        assert.deepEqual((0, recentProjects_1.readRecentProjects)(filePath), []);
    }
    finally {
        fs.unlinkSync(filePath);
    }
});
(0, node_test_1.test)('readRecentProjects parses a valid entries array', () => {
    const filePath = path.join(os.tmpdir(), `null-recent-projects-valid-${process.pid}.json`);
    const entries = [
        { path: 'C:\\Projects\\Foo', label: 'Foo', isWorkspaceFile: false, timestamp: 123 },
    ];
    fs.writeFileSync(filePath, JSON.stringify(entries));
    try {
        assert.deepEqual((0, recentProjects_1.readRecentProjects)(filePath), entries);
    }
    finally {
        fs.unlinkSync(filePath);
    }
});
//# sourceMappingURL=recentProjects.test.js.map