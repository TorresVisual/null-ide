import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  executableNames,
  findBundledBinary,
  findClangFormatPath,
  findExecutable,
  findRustfmtPath,
} from './probe';

function withTempDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-env-probe-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('executableNames', () => {
  it('expands PATHEXT on Windows', () => {
    assert.deepEqual(executableNames('claude', true, '.EXE;.CMD'), ['claude.exe', 'claude.cmd']);
  });
  it('keeps a name that already has an extension', () => {
    assert.deepEqual(executableNames('clang-cl.exe', true, '.EXE;.CMD'), ['clang-cl.exe']);
  });
  it('is the bare name elsewhere', () => {
    assert.deepEqual(executableNames('cmake', false), ['cmake']);
  });
  it('falls back to the default PATHEXT when it is empty', () => {
    assert.ok(executableNames('node', true, '').includes('node.cmd'));
  });
});

describe('findExecutable', () => {
  it('finds a file in the given dirs, in order', () => {
    withTempDir(a => withTempDir(b => {
      const file = executableNames('faketool')[0];
      fs.writeFileSync(path.join(b, file), '');
      assert.equal(findExecutable('faketool', [a, b]), path.join(b, file));
    }));
  });
  it('returns null when absent', () => {
    withTempDir(dir => assert.equal(findExecutable('faketool', [dir]), null));
  });
  it('does not treat a directory as an executable', () => {
    withTempDir(dir => {
      fs.mkdirSync(path.join(dir, executableNames('faketool')[0]));
      assert.equal(findExecutable('faketool', [dir]), null);
    });
  });
});

describe('findBundledBinary / configured paths', () => {
  it('finds a bundled binary when present', () => {
    withTempDir(dir => {
      fs.mkdirSync(path.join(dir, 'bin'));
      const fake = path.join(dir, 'bin', process.platform === 'win32' ? 'clang-format.exe' : 'clang-format');
      fs.writeFileSync(fake, '');
      assert.equal(findBundledBinary(dir, 'clang-format'), fake);
    });
  });
  it('prioritizes an explicitly configured clang-format path', () => {
    withTempDir(dir => {
      const custom = path.join(dir, 'custom-clang-format.exe');
      fs.writeFileSync(custom, '');
      assert.equal(findClangFormatPath(custom, dir), custom);
    });
  });
  // These two are spawned without a shell, so a .cmd/.bat shim earlier on PATH must not win over a real binary.
  it('never returns a .cmd shim for a tool that is spawned directly', { skip: process.platform !== 'win32' }, () => {
    withTempDir(shims => withTempDir(real => {
      fs.writeFileSync(path.join(shims, 'rustfmt.cmd'), '');
      fs.writeFileSync(path.join(shims, 'clang-format.cmd'), '');
      assert.equal(findRustfmtPath(undefined, undefined, [shims]), null);
      assert.equal(findClangFormatPath(undefined, undefined, [shims]), null);
      fs.writeFileSync(path.join(real, 'rustfmt.exe'), '');
      assert.equal(findRustfmtPath(undefined, undefined, [shims, real]), path.join(real, 'rustfmt.exe'));
    }));
  });
  it('prioritizes an explicitly configured rustfmt path', () => {
    withTempDir(dir => {
      const custom = path.join(dir, 'custom-rustfmt.exe');
      fs.writeFileSync(custom, '');
      assert.equal(findRustfmtPath(custom, dir), custom);
    });
  });
});
