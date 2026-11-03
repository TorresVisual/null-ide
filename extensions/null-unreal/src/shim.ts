// Terminal shim: a `null-unreal` on PATH that runs the CLI on the editor's own runtime.
// Written by the extension into globalStorage/bin; the CLI is out/cli.js.
export function shimFiles(execPath: string, cliPath: string): { 'null-unreal.cmd': string; 'null-unreal': string } {
  return {
    'null-unreal.cmd': [
      '@echo off',
      'set ELECTRON_RUN_AS_NODE=1',
      `"${execPath}" "${cliPath}" %*`,
      '',
    ].join('\r\n'),
    'null-unreal': [
      '#!/bin/sh',
      'export ELECTRON_RUN_AS_NODE=1',
      `exec "${execPath}" "${cliPath}" "$@"`,
      '',
    ].join('\n'),
  };
}

export function cliUsageSnippet(shimPath: string): string {
  return [
    `Null Unreal CLI: ${shimPath}`,
    'Run from the project folder (or pass --project <file>):',
    '  null-unreal build                  build the project (AutomationTool BuildCookRun)',
    '  null-unreal test [--filter <p>]    run automation tests; prints the result and the log path',
    '  null-unreal run                    launch the editor in game mode',
    '  null-unreal smoke                  headless smoke run, exits 124 on timeout',
    'Exit codes: the process code; 2 usage or resolution error; 124 timeout.',
  ].join('\n');
}
