'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const projectDetector_1 = require("./projectDetector");
const detecting = (...projects) => () => projects;
(0, node_test_1.test)('no detected projects yields no suggestions', () => {
    node_assert_1.default.deepStrictEqual((0, projectDetector_1.detectSuggestedButtons)('/x', detecting()), []);
});
(0, node_test_1.test)('Cargo.toml yields cargo suggestions', () => {
    const suggestions = (0, projectDetector_1.detectSuggestedButtons)('/x', detecting({ language: 'rust', manifest: 'Cargo.toml' }));
    node_assert_1.default.ok(suggestions.some(s => s.command === 'cargo run'));
    node_assert_1.default.ok(suggestions.some(s => s.command === 'cargo build'));
    node_assert_1.default.ok(suggestions.some(s => s.command === 'cargo test'));
});
(0, node_test_1.test)('CMakeLists.txt yields cmake suggestions', () => {
    const suggestions = (0, projectDetector_1.detectSuggestedButtons)('/x', detecting({ language: 'cpp', manifest: 'CMakeLists.txt' }));
    node_assert_1.default.ok(suggestions.some(s => s.command === 'cmake -B build'));
    node_assert_1.default.ok(suggestions.some(s => s.command === 'cmake --build build'));
});
(0, node_test_1.test)('a .csproj yields dotnet suggestions', () => {
    const suggestions = (0, projectDetector_1.detectSuggestedButtons)('/x', detecting({ language: 'dotnet', manifest: '.csproj' }));
    node_assert_1.default.ok(suggestions.some(s => s.command === 'dotnet build'));
    node_assert_1.default.ok(suggestions.some(s => s.command === 'dotnet run'));
});
(0, node_test_1.test)('other C++ markers do not suggest cmake commands', () => {
    const suggestions = (0, projectDetector_1.detectSuggestedButtons)('/x', detecting({ language: 'cpp', manifest: 'compile_commands.json' }, { language: 'cpp', manifest: '.clangd' }, { language: 'node', manifest: 'package.json' }));
    node_assert_1.default.deepStrictEqual(suggestions, []);
});
(0, node_test_1.test)('multiple manifests yield the union of their suggestions', () => {
    const suggestions = (0, projectDetector_1.detectSuggestedButtons)('/x', detecting({ language: 'rust', manifest: 'Cargo.toml' }, { language: 'cpp', manifest: 'CMakeLists.txt' }));
    node_assert_1.default.ok(suggestions.some(s => s.command === 'cargo run'));
    node_assert_1.default.ok(suggestions.some(s => s.command === 'cmake -B build'));
});
(0, node_test_1.test)('suggestion ids are unique within one result set', () => {
    const suggestions = (0, projectDetector_1.detectSuggestedButtons)('/x', detecting({ language: 'rust', manifest: 'Cargo.toml' }, { language: 'cpp', manifest: 'CMakeLists.txt' }, { language: 'dotnet', manifest: '.csproj' }));
    const ids = suggestions.map(s => s.id);
    node_assert_1.default.strictEqual(new Set(ids).size, ids.length);
});
(0, node_test_1.test)('the folder path is passed to the detector', () => {
    let seen = '';
    (0, projectDetector_1.detectSuggestedButtons)('/some/folder', p => { seen = p; return []; });
    node_assert_1.default.strictEqual(seen, '/some/folder');
});
(0, node_test_1.test)('cargo suggestions carry the rustc problem matcher', () => {
    const suggestions = (0, projectDetector_1.detectSuggestedButtons)('/x', detecting({ language: 'rust', manifest: 'Cargo.toml' }));
    node_assert_1.default.ok(suggestions.length > 0 && suggestions.every(s => s.problemMatcher === '$null-rustc'));
});
//# sourceMappingURL=projectDetector.test.js.map