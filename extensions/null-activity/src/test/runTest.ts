'use strict';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests, downloadAndUnzipVSCode } from '@vscode/test-electron';

async function main(): Promise<void> {
  const installDir = process.env.NULL_IDE_INSTALL_DIR
    ?? path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Null IDE');

  const extensionDevelopmentPath = path.join(installDir, 'resources', 'app', 'extensions', 'null-activity');
  if (!fs.existsSync(extensionDevelopmentPath)) {
    throw new Error(`Synced null-activity not found at '${extensionDevelopmentPath}'. Run scripts/sync-local.ps1 first.`);
  }

  // Null IDE's own executable can't host this run: its fixed win32MutexName collides with the
  // already-running Null IDE window. A vanilla VS Code build loads the exact synced extension code.
  const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');

  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-spec-workspace-'));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-spec-userdata-'));
  const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-spec-extensions-'));

  // Inherited from an Electron parent (e.g. an IDE terminal), it would run Electron as plain Node.
  delete process.env.ELECTRON_RUN_AS_NODE;

  try {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspaceDir, '--user-data-dir', userDataDir, '--extensions-dir', extensionsDir],
    });
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(extensionsDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('Failed to run integration specs');
  console.error(err);
  process.exit(1);
});
