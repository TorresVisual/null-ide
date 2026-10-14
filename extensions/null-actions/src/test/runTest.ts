'use strict';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests, downloadAndUnzipVSCode } from '@vscode/test-electron';

async function main(): Promise<void> {
  const installDir = process.env.NULL_IDE_INSTALL_DIR
    ?? path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Null IDE');

  // null-actions lists null-env in extensionDependencies, so the vanilla host must load it too.
  const extensionDevelopmentPath = ['null-actions', 'null-env'].map(name => {
    const dir = path.join(installDir, 'resources', 'app', 'extensions', name);
    if (!fs.existsSync(dir)) {
      throw new Error(`Synced ${name} not found at '${dir}'. Run scripts/sync-local.ps1 first.`);
    }
    return dir;
  });

  // Null IDE's own executable can't host this run: its product.json bakes
  // in a fixed win32MutexName ("nullide"), shared by every build regardless
  // of install path, and this harness is typically invoked from inside an
  // already-running Null IDE window (e.g. its own integrated agent
  // terminal) - so the OS-level single-instance mutex always collides and
  // the second instance's window gets force-closed mid-test. A cloned copy
  // of the install would embed the identical product.json and hit the same
  // collision. Downloading a separate vanilla VS Code build sidesteps this
  // (different product identity, different mutex) while still loading and
  // testing the exact synced null-actions extension code below via
  // extensionDevelopmentPath.
  const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');

  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-actions-spec-workspace-'));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-actions-spec-userdata-'));
  const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-actions-spec-extensions-'));

  // If set, this forces any Electron binary to run as plain Node instead of
  // launching the app - breaks the actual GUI launch this harness needs.
  // Can be inherited from an Electron-based parent process (e.g. an IDE's
  // own integrated terminal), so clear it here rather than relying on the
  // caller's shell to be clean.
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
