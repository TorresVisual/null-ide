"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shimFiles = shimFiles;
exports.cliUsageSnippet = cliUsageSnippet;
// Terminal shim: a `null-unreal` on PATH that runs the CLI on the editor's own runtime.
// Written by the extension into globalStorage/bin; the CLI is out/cli.js.
function shimFiles(execPath, cliPath) {
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
function cliUsageSnippet(shimPath) {
    return [
        `Null Unreal CLI: ${shimPath}`,
        'Run from the project folder (or pass --project <file>):',
        '  null-unreal build                  build the project (AutomationTool BuildCookRun)',
        '  null-unreal test [--filter <p>]    run automation tests; prints the result and the log path',
        '  null-unreal run                    launch the editor in game mode',
        '  null-unreal smoke                  headless smoke run, exits 124 on timeout',
        '  null-unreal export <asset|folder>... [--json] [--force]',
        '                                     read .uasset files through the engine into Saved/NullUnreal/assets (cached)',
        'Exit codes: the process code; 1 an asset failed to export; 2 usage or resolution error; 124 timeout.',
    ].join('\n');
}
//# sourceMappingURL=shim.js.map