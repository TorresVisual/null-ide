'use strict';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests, downloadAndUnzipVSCode } from '@vscode/test-electron';

async function main(): Promise<void> {
  const installDir = process.env.NULL_IDE_INSTALL_DIR
    ?? path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Null IDE');

  // null-tools lists null-accounts in extensionDependencies, so the vanilla host must load it too.
  const extensionDevelopmentPath = ['null-tools', 'null-accounts'].map(name => {
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
  // testing the exact synced null-tools extension code below via
  // extensionDevelopmentPath.
  const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');

  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-tools-spec-workspace-'));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-tools-spec-userdata-'));
  const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-tools-spec-extensions-'));

  // null-tools rewrites these global settings on every activation
  // (disableRestrictedMode / ensureWindowTitleFormat). In a fresh profile
  // that write races the end of the run and makes the host exit 1 even when
  // every spec passed, so pre-seed the values it would otherwise write.
  fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'User', 'settings.json'), JSON.stringify({
    'security.workspace.trust.enabled': false,
    'security.workspace.trust.startupPrompt': 'never',
    'security.workspace.trust.untrustedFiles': 'open',
    'security.workspace.trust.emptyWindow': false,
    'window.title': '${dirty}${rootName} - ${activeEditorShort}',
  }));

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
    // VS Code's child processes (agent host etc.) can still hold the profile
    // for a moment after runTests() settles; cleanup must never mask the
    // spec result.
    for (const dir of [workspaceDir, userDataDir, extensionsDir]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
      } catch (err) {
        console.warn(`Could not remove temp dir ${dir}: ${(err as Error).message}`);
      }
    }
  }
}

main().catch(err => {
  console.error('Failed to run integration specs');
  console.error(err);
  process.exit(1);
});
