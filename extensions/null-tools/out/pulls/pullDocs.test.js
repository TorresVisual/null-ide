'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const pullDocs_1 = require("./pullDocs");
const ref = {
    owner: 'TorresVisual', repo: 'null-ide', pull: 12, path: 'src/a b/é.ts',
    sha: 'a'.repeat(40), head: 'b'.repeat(40), side: 'LEFT',
};
(0, node_test_1.default)('docQuery / parseDocQuery round-trip, including spaces and unicode in the path', () => {
    node_assert_1.default.deepStrictEqual((0, pullDocs_1.parseDocQuery)(`/${ref.path}`, (0, pullDocs_1.docQuery)(ref)), ref);
});
(0, node_test_1.default)('parseDocQuery rejects a traversal path, dot-only owner/repo, short shas, a bad side and a bad pull number', () => {
    const q = (over) => (0, pullDocs_1.docQuery)({ ...ref, ...over });
    node_assert_1.default.strictEqual((0, pullDocs_1.parseDocQuery)('/src/../../etc/passwd', q({})), null);
    node_assert_1.default.strictEqual((0, pullDocs_1.parseDocQuery)('/', q({})), null);
    node_assert_1.default.strictEqual((0, pullDocs_1.parseDocQuery)('/a.ts', q({ owner: '..' })), null);
    node_assert_1.default.strictEqual((0, pullDocs_1.parseDocQuery)('/a.ts', q({ repo: 'a/b' })), null);
    node_assert_1.default.strictEqual((0, pullDocs_1.parseDocQuery)('/a.ts', q({ sha: 'abc123' })), null);
    node_assert_1.default.strictEqual((0, pullDocs_1.parseDocQuery)('/a.ts', q({ head: 'z'.repeat(40) })), null);
    node_assert_1.default.strictEqual((0, pullDocs_1.parseDocQuery)('/a.ts', q({ side: 'MIDDLE' })), null);
    node_assert_1.default.strictEqual((0, pullDocs_1.parseDocQuery)('/a.ts', q({ pull: 0 })), null);
    node_assert_1.default.strictEqual((0, pullDocs_1.parseDocQuery)('/a.ts', ''), null);
});
(0, node_test_1.default)('decodeBlob returns text as UTF-8 and replaces a binary file with the placeholder', () => {
    node_assert_1.default.strictEqual((0, pullDocs_1.decodeBlob)(Buffer.from('héllo\n', 'utf8')), 'héllo\n');
    node_assert_1.default.strictEqual((0, pullDocs_1.decodeBlob)(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])), pullDocs_1.PLACEHOLDER);
    node_assert_1.default.strictEqual((0, pullDocs_1.decodeBlob)(Buffer.alloc(0)), '');
});
//# sourceMappingURL=pullDocs.test.js.map