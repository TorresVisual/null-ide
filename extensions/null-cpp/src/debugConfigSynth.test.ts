import test from 'node:test';
import assert from 'node:assert/strict';
import { synthDebugConfig } from './debugConfigSynth';

test('synthDebugConfig builds a cppvsdbg config for MSVC', () => {
  const config = synthDebugConfig({
    targetName: 'app',
    artifactPath: 'D:\\proj\\build\\msvc-debug\\Debug\\app.exe',
    sourceDir: 'D:\\proj',
    toolchainKind: 'msvc',
  });
  assert.deepEqual(config, {
    type: 'cppvsdbg',
    name: 'Debug app',
    request: 'launch',
    program: 'D:\\proj\\build\\msvc-debug\\Debug\\app.exe',
    args: [],
    cwd: 'D:\\proj',
  });
});

test('synthDebugConfig builds a cppdbg/lldb config for native Clang, with an explicit miDebuggerPath', () => {
  const config = synthDebugConfig({
    targetName: 'app',
    artifactPath: 'D:\\proj\\build\\clang-debug\\app.exe',
    sourceDir: 'D:\\proj',
    toolchainKind: 'clang',
    nativeDebugger: { mode: 'lldb', path: 'C:\\LLVM\\bin\\lldb.exe' },
  });
  assert.equal(config.type, 'cppdbg');
  assert.equal(config.MIMode, 'lldb');
  assert.equal(config.miDebuggerPath, 'C:\\LLVM\\bin\\lldb.exe');
  assert.equal(config.pipeTransport, undefined);
});

test('synthDebugConfig throws for a native toolchain with no gdb/lldb resolved on PATH', () => {
  assert.throws(() =>
    synthDebugConfig({
      targetName: 'app',
      artifactPath: 'D:\\proj\\build\\clang-debug\\app.exe',
      sourceDir: 'D:\\proj',
      toolchainKind: 'clang',
    })
  );
});

test('synthDebugConfig builds a cppdbg/gdb pipeTransport config for WSL, translating paths to POSIX', () => {
  const config = synthDebugConfig({
    targetName: 'app',
    artifactPath: 'D:\\proj\\build\\wsl-debug\\app',
    sourceDir: 'D:\\proj',
    toolchainKind: 'wsl-gcc',
    wslDistro: 'Ubuntu',
  });
  assert.deepEqual(config, {
    type: 'cppdbg',
    name: 'Debug app',
    request: 'launch',
    program: '/mnt/d/proj/build/wsl-debug/app',
    args: [],
    cwd: '/mnt/d/proj',
    MIMode: 'gdb',
    pipeTransport: {
      pipeProgram: 'wsl.exe',
      pipeArgs: ['-d', 'Ubuntu'],
      debuggerPath: '/usr/bin/gdb',
    },
  });
});

test('synthDebugConfig throws for a WSL toolchain with no distro', () => {
  assert.throws(() =>
    synthDebugConfig({
      targetName: 'app',
      artifactPath: 'D:\\proj\\build\\wsl-debug\\app',
      sourceDir: 'D:\\proj',
      toolchainKind: 'wsl-clang',
    })
  );
});
