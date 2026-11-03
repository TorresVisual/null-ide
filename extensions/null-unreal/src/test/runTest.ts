'use strict';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests, downloadAndUnzipVSCode } from '@vscode/test-electron';

async function main(): Promise<void> {
  const installDir = process.env.NULL_IDE_INSTALL_DIR
    ?? path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Null IDE');

  const extensionDevelopmentPath = path.join(installDir, 'resources', 'app', 'extensions', 'null-unreal');
  if (!fs.existsSync(extensionDevelopmentPath)) {
    throw new Error(
      `Synced null-unreal not found at '${extensionDevelopmentPath}'. Run scripts/sync-local.ps1 first.`,
    );
  }

  // A vanilla VS Code build: Null IDE's own executable would share its single-instance mutex
  // with the window that invoked this harness. See null-env's runTest.ts for the full reasoning.
  const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');

  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-unreal-spec-workspace-'));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-unreal-spec-userdata-'));
  const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-unreal-spec-extensions-'));
  // The extension activates on workspaceContains:**/*.uproject.
  fs.writeFileSync(path.join(workspaceDir, 'Fixture.uproject'), '{"EngineAssociation":""}');

  // Forces Electron binaries to run as plain Node; inherited from a parent Electron shell it would break the GUI launch.
  delete process.env.ELECTRON_RUN_AS_NODE;

  try {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspaceDir,
        '--user-data-dir', userDataDir,
        '--extensions-dir', extensionsDir,
      ],
    });
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(extensionsDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error('Failed to run integration specs');
  console.error(err);
  process.exit(1);
});
