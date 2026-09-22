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
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const configResolver_1 = require("./configResolver");
(0, node_test_1.describe)('configResolver', () => {
    (0, node_test_1.it)('formats YAML to clang-format inline style argument', () => {
        const yaml = `
      BasedOnStyle: LLVM
      IndentWidth: 4
      TabWidth: 4
      UseTab: Never
    `;
        const arg = (0, configResolver_1.formatYamlToClangFormatStyleArg)(yaml);
        assert.strictEqual(arg, '{BasedOnStyle: LLVM, IndentWidth: 4, TabWidth: 4, UseTab: Never}');
    });
    (0, node_test_1.it)('formats YAML object dictionary to clang-format inline style argument', () => {
        const obj = {
            BasedOnStyle: 'LLVM',
            IndentWidth: 4,
            TabWidth: 4,
            UseTab: 'Never',
        };
        const arg = (0, configResolver_1.formatYamlToClangFormatStyleArg)(obj);
        assert.strictEqual(arg, '{BasedOnStyle: LLVM, IndentWidth: 4, TabWidth: 4, UseTab: Never}');
    });
    (0, node_test_1.it)('formats TOML to rustfmt config argument', () => {
        const toml = `
      edition = "2021"
      max_width = 100
      tab_spaces = 4
    `;
        const arg = (0, configResolver_1.formatTomlToRustfmtConfigArg)(toml);
        assert.strictEqual(arg, 'edition="2021",max_width=100,tab_spaces=4');
    });
    (0, node_test_1.it)('formats TOML object dictionary to rustfmt config argument', () => {
        const obj = {
            edition: '2021',
            max_width: 100,
            tab_spaces: 4,
        };
        const arg = (0, configResolver_1.formatTomlToRustfmtConfigArg)(obj);
        assert.strictEqual(arg, 'edition="2021",max_width=100,tab_spaces=4');
    });
    (0, node_test_1.it)('finds config files upwards in folder structure', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-format-test-'));
        try {
            const subDir = path.join(tempDir, 'sub', 'nested');
            fs.mkdirSync(subDir, { recursive: true });
            const configPath = path.join(tempDir, '.clang-format');
            fs.writeFileSync(configPath, 'BasedOnStyle: Google\n');
            const found = (0, configResolver_1.findConfigFileUpwards)(subDir, ['.clang-format'], tempDir);
            assert.strictEqual(found, configPath);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)('resolves clang-format style with workspace file priority', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-format-test-'));
        try {
            const targetFile = path.join(tempDir, 'main.cpp');
            fs.writeFileSync(targetFile, 'int main() {}\n');
            // Without config file -> default
            const defaultRes = (0, configResolver_1.resolveClangFormatStyle)(targetFile, '', 'IndentWidth: 2', tempDir);
            assert.strictEqual(defaultRes.source, 'default');
            assert.strictEqual(defaultRes.styleArg, '{IndentWidth: 2}');
            // With config file -> workspace
            const configPath = path.join(tempDir, '.clang-format');
            fs.writeFileSync(configPath, 'IndentWidth: 8\n');
            const fileRes = (0, configResolver_1.resolveClangFormatStyle)(targetFile, '', 'IndentWidth: 2', tempDir);
            assert.strictEqual(fileRes.source, 'workspace');
            assert.strictEqual(fileRes.styleArg, `file:${configPath}`);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)('resolves rustfmt config with workspace file priority', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-format-test-'));
        try {
            const targetFile = path.join(tempDir, 'src', 'main.rs');
            fs.mkdirSync(path.dirname(targetFile), { recursive: true });
            fs.writeFileSync(targetFile, 'fn main() {}\n');
            // Without config file -> default
            const defaultRes = (0, configResolver_1.resolveRustfmtConfig)(targetFile, '', 'edition = "2021"', tempDir);
            assert.strictEqual(defaultRes.source, 'default');
            assert.strictEqual(defaultRes.inlineOptions, 'edition="2021"');
            // With config file -> workspace
            const configPath = path.join(tempDir, 'rustfmt.toml');
            fs.writeFileSync(configPath, 'edition = "2024"\n');
            const fileRes = (0, configResolver_1.resolveRustfmtConfig)(targetFile, '', 'edition = "2021"', tempDir);
            assert.strictEqual(fileRes.source, 'workspace');
            assert.strictEqual(fileRes.configPath, configPath);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=configResolver.test.js.map