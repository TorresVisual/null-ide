import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

suite('null-unreal activation', () => {
  test('activates, registers its commands and writes the shim', async () => {
    const extension = vscode.extensions.getExtension('null.null-unreal');
    assert.ok(extension, 'null.null-unreal extension not found');
    const api = await extension!.activate() as { shimDir: string };
    assert.strictEqual(extension!.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    for (const c of ['run', 'build', 'test', 'smoke', 'showCliPath', 'exportAsset', 'clearAssetCache']) {
      assert.ok(commands.includes(`null-unreal.${c}`), `null-unreal.${c} not registered`);
    }
    assert.ok(fs.existsSync(path.join(api.shimDir, 'null-unreal.cmd')), 'null-unreal.cmd shim missing');
  });
});
