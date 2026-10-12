import * as assert from 'assert';
import * as vscode from 'vscode';

suite('null-env activation', () => {
  test('activates and registers its commands', async () => {
    const extension = vscode.extensions.getExtension('null.null-env');
    assert.ok(extension, 'null.null-env extension not found');
    await extension!.activate();
    assert.strictEqual(extension!.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('null.env.check'), 'null.env.check not registered');
    assert.ok(commands.includes('null.env.getFindings'), 'null.env.getFindings not registered');
  });

  test('getFindings returns plain JSON findings', async () => {
    const findings = await vscode.commands.executeCommand<unknown[]>('null.env.getFindings');
    assert.ok(Array.isArray(findings));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(findings)), findings);
  });

  test('ensureDebugType blocks a debug type whose extension is missing, and passes unknown types', async () => {
    const api = vscode.extensions.getExtension('null.null-env')!.exports;
    // The runner uses an empty extensions dir, so CodeLLDB and cpptools are absent.
    assert.strictEqual(await api.ensureDebugType('lldb'), false);
    assert.strictEqual(await api.ensureDebugType('cppdbg'), false);
    assert.strictEqual(await api.ensureDebugType('node'), true);
  });
});
