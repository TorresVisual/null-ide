'use strict';

import * as assert from 'assert';
import * as vscode from 'vscode';
import { NullAccountsApi } from '../../api';

suite('null-accounts activation', () => {
  test('activates and exports a working API', async () => {
    const extension = vscode.extensions.getExtension<NullAccountsApi>('null.null-accounts');
    assert.ok(extension, 'null.null-accounts extension not found');

    const api = await extension!.activate();
    assert.ok(api, 'activate() returned no API');

    // The run uses a fresh --user-data-dir, so no accounts exist yet.
    assert.deepStrictEqual(api.getAccounts(), []);
    assert.strictEqual(api.getAccountForFolder(vscode.Uri.file(process.cwd())), undefined);

    const stranger = { id: 'x', provider: 'github', host: 'github.com', username: 'u', email: 'u@e.com', authMethod: 'oauth' } as const;
    assert.strictEqual(await api.getToken(stranger), undefined);

    // Phase 2: an unbound folder has no account, and a silent token request for an unknown
    // GitHub account (no externalId) resolves undefined instead of prompting or throwing.
    assert.strictEqual(typeof api.ensureAccountForFolder, 'function');
    assert.strictEqual(await api.getToken(stranger, ['repo'], { interactive: false }), undefined);
  });
});
