'use strict';

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { NullActivityApi } from '../../types';

suite('null-activity WakaTime import', () => {
  test('importing a small export adds its time through the API, and a non-export is rejected without touching data', async function () {
    this.timeout(30_000);
    const api = await vscode.extensions.getExtension<NullActivityApi>('null.null-activity')!.activate();
    assert.ok((await vscode.commands.getCommands(true)).includes('null-activity.importWakaTime'));

    const base = Date.UTC(2001, 0, 2, 12) / 1000;
    const heartbeats = [0, 60, 120].map((s) => ({
      time: base + s, project: 'fixture-project', language: 'TypeScript', entity: '/nonexistent/fixture-project/src/a.ts', type: 'file',
    }));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-waka-spec-'));
    const good = path.join(dir, 'export.json');
    const bad = path.join(dir, 'not-an-export.json');
    fs.writeFileSync(good, JSON.stringify({ user: { timeout: 15 }, range: {}, days: [{ date: '2001-01-02', heartbeats }] }));
    fs.writeFileSync(bad, JSON.stringify({ hello: 'world' }));
    const window = { from: base * 1000 - 3_600_000, to: base * 1000 + 3_600_000 };

    try {
      await vscode.commands.executeCommand('null-activity.importWakaTime', vscode.Uri.file(bad));
      assert.deepStrictEqual(api.getIntervals(window), [], 'a rejected file must not add data');

      await vscode.commands.executeCommand('null-activity.importWakaTime', vscode.Uri.file(good));
      const got = api.getIntervals(window).map((i) => [i.project.name, i.language, i.file, i.end - i.start]);
      assert.deepStrictEqual(got, [['fixture-project', 'typescript', 'a.ts', 120_000]]);

      await vscode.commands.executeCommand('null-activity.importWakaTime', vscode.Uri.file(good));
      assert.strictEqual(api.getIntervals(window).length, 1, 're-importing replaces instead of duplicating');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
