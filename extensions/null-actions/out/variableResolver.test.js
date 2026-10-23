'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const variableResolver_1 = require("./variableResolver");
(0, node_test_1.test)('substitutes each known variable', () => {
    const ctx = {
        workspaceFolder: '/repo',
        file: '/repo/src/a.ts',
        fileBasename: 'a.ts',
        fileDirname: '/repo/src',
        relativeFile: 'src/a.ts',
        selectedText: 'const x = 1;',
        lineNumber: '42',
    };
    node_assert_1.default.strictEqual((0, variableResolver_1.resolveVariables)('${workspaceFolder}', ctx), '/repo');
    node_assert_1.default.strictEqual((0, variableResolver_1.resolveVariables)('${file}', ctx), '/repo/src/a.ts');
    node_assert_1.default.strictEqual((0, variableResolver_1.resolveVariables)('${fileBasename}', ctx), 'a.ts');
    node_assert_1.default.strictEqual((0, variableResolver_1.resolveVariables)('${fileDirname}', ctx), '/repo/src');
    node_assert_1.default.strictEqual((0, variableResolver_1.resolveVariables)('${relativeFile}', ctx), 'src/a.ts');
    node_assert_1.default.strictEqual((0, variableResolver_1.resolveVariables)('${selectedText}', ctx), 'const x = 1;');
    node_assert_1.default.strictEqual((0, variableResolver_1.resolveVariables)('${lineNumber}', ctx), '42');
});
(0, node_test_1.test)('substitutes multiple variables in one template', () => {
    const ctx = { fileBasename: 'a.ts', lineNumber: '3' };
    node_assert_1.default.strictEqual((0, variableResolver_1.resolveVariables)('lint ${fileBasename} --line ${lineNumber}', ctx), 'lint a.ts --line 3');
});
(0, node_test_1.test)('resolves ${env:VAR} from the provided env map', () => {
    const ctx = { env: { FOO: 'bar' } };
    node_assert_1.default.strictEqual((0, variableResolver_1.resolveVariables)('echo ${env:FOO}', ctx), 'echo bar');
});
(0, node_test_1.test)('unresolved variable (missing from context) is left as the literal token', () => {
    const ctx = {};
    node_assert_1.default.strictEqual((0, variableResolver_1.resolveVariables)('open ${file}', ctx), 'open ${file}');
    node_assert_1.default.strictEqual((0, variableResolver_1.resolveVariables)('echo ${env:MISSING}', ctx), 'echo ${env:MISSING}');
});
(0, node_test_1.test)('unknown variable name is left untouched', () => {
    const ctx = { file: '/a.ts' };
    node_assert_1.default.strictEqual((0, variableResolver_1.resolveVariables)('${notAVariable}', ctx), '${notAVariable}');
});
(0, node_test_1.test)('template with no variables passes through unchanged', () => {
    node_assert_1.default.strictEqual((0, variableResolver_1.resolveVariables)('npm run build', {}), 'npm run build');
});
(0, node_test_1.test)('collects known variables it could not resolve, but not shell-style ${NAME}', () => {
    const missing = [];
    (0, variableResolver_1.resolveVariables)('cp ${file} ${env:NOPE} ${HOME} ${notAVariable}', {}, missing);
    node_assert_1.default.deepStrictEqual(missing, ['${file}', '${env:NOPE}']);
});
//# sourceMappingURL=variableResolver.test.js.map