import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  findBundledBinary,
  findClangFormatPath,
  findRustfmtPath,
} from './toolchainDiscovery';

describe('toolchainDiscovery', () => {
  it('finds bundled binary when present', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-format-bin-test-'));
    try {
      const binDir = path.join(tempDir, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      const fakeBinary = path.join(binDir, process.platform === 'win32' ? 'clang-format.exe' : 'clang-format');
      fs.writeFileSync(fakeBinary, '');

      const found = findBundledBinary(tempDir, 'clang-format');
      assert.strictEqual(found, fakeBinary);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('prioritizes explicitly configured path', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-format-bin-test-'));
    try {
      const customPath = path.join(tempDir, 'custom-clang-format.exe');
      fs.writeFileSync(customPath, '');

      const found = findClangFormatPath(customPath, tempDir);
      assert.strictEqual(found, customPath);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('prioritizes explicitly configured rustfmt path', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-format-bin-test-'));
    try {
      const customPath = path.join(tempDir, 'custom-rustfmt.exe');
      fs.writeFileSync(customPath, '');

      const found = findRustfmtPath(customPath, tempDir);
      assert.strictEqual(found, customPath);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
