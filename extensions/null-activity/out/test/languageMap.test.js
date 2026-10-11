'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const languageMap_1 = require("../languageMap");
(0, node_test_1.test)('maps WakaTime names whose slug would differ from the VS Code language id', () => {
    const want = {
        'C++': 'cpp',
        'C#': 'csharp',
        'F#': 'fsharp',
        Batchfile: 'bat',
        Bash: 'shellscript',
        Text: 'plaintext',
        'JSON with Comments': 'jsonc',
        'Vue.js': 'vue',
    };
    for (const [name, id] of Object.entries(want))
        node_assert_1.default.strictEqual((0, languageMap_1.languageId)(name), id, name);
});
(0, node_test_1.test)('other names fall back to a lowercase slug', () => {
    node_assert_1.default.strictEqual((0, languageMap_1.languageId)('TypeScript'), 'typescript');
    node_assert_1.default.strictEqual((0, languageMap_1.languageId)('Markdown'), 'markdown');
    node_assert_1.default.strictEqual((0, languageMap_1.languageId)('C'), 'c');
    node_assert_1.default.strictEqual((0, languageMap_1.languageId)('Image (svg)'), 'image-svg');
    node_assert_1.default.strictEqual((0, languageMap_1.languageId)('Microsoft Visual Studio Solution'), 'microsoft-visual-studio-solution');
});
(0, node_test_1.test)('empty stays empty and object prototype names are not special', () => {
    node_assert_1.default.strictEqual((0, languageMap_1.languageId)(''), '');
    node_assert_1.default.strictEqual((0, languageMap_1.languageId)('constructor'), 'constructor');
});
//# sourceMappingURL=languageMap.test.js.map