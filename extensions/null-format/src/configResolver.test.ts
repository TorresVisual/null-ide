import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  findConfigFileUpwards,
  formatYamlToClangFormatStyleArg,
  formatTomlToRustfmtConfigArg,
  resolveClangFormatStyle,
  resolveRustfmtConfig,
} from './configResolver';

describe('configResolver', () => {
  it('formats YAML to clang-format inline style argument', () => {
    const yaml = `
      BasedOnStyle: LLVM
      IndentWidth: 4
      TabWidth: 4
      UseTab: Never
    `;
    const arg = formatYamlToClangFormatStyleArg(yaml);
    assert.strictEqual(arg, '{BasedOnStyle: LLVM, IndentWidth: 4, TabWidth: 4, UseTab: Never}');
  });

  it('formats YAML object dictionary to clang-format inline style argument', () => {
    const obj = {
      BasedOnStyle: 'LLVM',
      IndentWidth: 4,
      TabWidth: 4,
      UseTab: 'Never',
    };
    const arg = formatYamlToClangFormatStyleArg(obj);
    assert.strictEqual(arg, '{BasedOnStyle: LLVM, IndentWidth: 4, TabWidth: 4, UseTab: Never}');
  });

  it('formats TOML to rustfmt config argument', () => {
    const toml = `
      edition = "2021"
      max_width = 100
      tab_spaces = 4
    `;
    const arg = formatTomlToRustfmtConfigArg(toml);
    assert.strictEqual(arg, 'edition="2021",max_width=100,tab_spaces=4');
  });

  it('formats TOML object dictionary to rustfmt config argument', () => {
    const obj = {
      edition: '2021',
      max_width: 100,
      tab_spaces: 4,
    };
    const arg = formatTomlToRustfmtConfigArg(obj);
    assert.strictEqual(arg, 'edition="2021",max_width=100,tab_spaces=4');
  });

  it('finds config files upwards in folder structure', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-format-test-'));
    try {
      const subDir = path.join(tempDir, 'sub', 'nested');
      fs.mkdirSync(subDir, { recursive: true });

      const configPath = path.join(tempDir, '.clang-format');
      fs.writeFileSync(configPath, 'BasedOnStyle: Google\n');

      const found = findConfigFileUpwards(subDir, ['.clang-format'], tempDir);
      assert.strictEqual(found, configPath);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves clang-format style with workspace file priority', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-format-test-'));
    try {
      const targetFile = path.join(tempDir, 'main.cpp');
      fs.writeFileSync(targetFile, 'int main() {}\n');

      // Without config file -> default
      const defaultRes = resolveClangFormatStyle(targetFile, '', 'IndentWidth: 2', tempDir);
      assert.strictEqual(defaultRes.source, 'default');
      assert.strictEqual(defaultRes.styleArg, '{IndentWidth: 2}');

      // With config file -> workspace
      const configPath = path.join(tempDir, '.clang-format');
      fs.writeFileSync(configPath, 'IndentWidth: 8\n');

      const fileRes = resolveClangFormatStyle(targetFile, '', 'IndentWidth: 2', tempDir);
      assert.strictEqual(fileRes.source, 'workspace');
      assert.strictEqual(fileRes.styleArg, `file:${configPath}`);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves rustfmt config with workspace file priority', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-format-test-'));
    try {
      const targetFile = path.join(tempDir, 'src', 'main.rs');
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
      fs.writeFileSync(targetFile, 'fn main() {}\n');

      // Without config file -> default
      const defaultRes = resolveRustfmtConfig(targetFile, '', 'edition = "2021"', tempDir);
      assert.strictEqual(defaultRes.source, 'default');
      assert.strictEqual(defaultRes.inlineOptions, 'edition="2021"');

      // With config file -> workspace
      const configPath = path.join(tempDir, 'rustfmt.toml');
      fs.writeFileSync(configPath, 'edition = "2024"\n');

      const fileRes = resolveRustfmtConfig(targetFile, '', 'edition = "2021"', tempDir);
      assert.strictEqual(fileRes.source, 'workspace');
      assert.strictEqual(fileRes.configPath, configPath);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
