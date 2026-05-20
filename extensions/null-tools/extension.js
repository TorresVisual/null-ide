'use strict';

const vscode = require('vscode');
const { execSync, spawn } = require('child_process');

const PROMPT =
  'Output ONLY a single git commit message for the staged diff below. ' +
  'No explanation. No preamble. No code block fences. No bullet points. No quotes. ' +
  'Use conventional commit format: type: short description ' +
  '(imperative mood, under 72 chars). ' +
  'Types: feat, fix, chore, refactor, docs, style, test. ' +
  'Your entire response must be exactly one line -- the commit message itself.\n\n' +
  'Staged diff:\n';

function getStagedDiff(cwd) {
  try {
    const staged = execSync('git diff --staged', { cwd, encoding: 'utf8', timeout: 10000 });
    if (staged.trim()) return staged;
    return execSync('git diff HEAD', { cwd, encoding: 'utf8', timeout: 10000 });
  } catch {
    return '';
  }
}

function runClaude(diff, cwd) {
  return new Promise((resolve, reject) => {
    // Pass everything via stdin to avoid Windows cmd.exe argument quoting issues.
    // --print enables non-interactive mode and reads prompt from stdin.
    const child = spawn('claude', ['--print'], {
      cwd,
      shell: true,
      windowsHide: true,
    });

    let out = '';
    let err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));

    child.stdin.write(PROMPT + diff);
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('claude timed out after 30 s'));
    }, 30000);

    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) {
        const msg = out.trim();
        if (msg) resolve(msg);
        else reject(new Error(`claude produced no output (stderr: ${err.trim() || 'none'})`));
      } else {
        reject(new Error(err.trim() || `claude exited with code ${code}`));
      }
    });
  });
}

function activate(context) {
  // Status bar item — used as a reliable DOM click target from the injected
  // workbench button (AMD and Node.js are unavailable in the renderer context).
  const bar = vscode.window.createStatusBarItem('null.gen', vscode.StatusBarAlignment.Right, 0);
  bar.text = '$(sparkle)';
  bar.tooltip = 'Null: generate commit message';
  bar.command = 'null.generateCommitMessage';
  bar.show();
  context.subscriptions.push(bar);

  const cmd = vscode.commands.registerCommand('null.generateCommitMessage', async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      vscode.window.showErrorMessage('Open a folder first.');
      return;
    }
    const cwd = folders[0].uri.fsPath;

    const diff = getStagedDiff(cwd);
    if (!diff.trim()) {
      vscode.window.showWarningMessage('No changes found (nothing staged or committed).');
      return;
    }

    let message;
    try {
      await vscode.window.withProgress(
        { location: { viewId: 'workbench.scm' }, title: 'Generating commit message...' },
        async () => {
          message = await runClaude(diff, cwd);
        }
      );
    } catch (err) {
      vscode.window.showErrorMessage(`Null: commit message generation failed — ${err.message}`);
      return;
    }

    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (!gitExt) {
      vscode.window.showErrorMessage('Built-in git extension not found.');
      return;
    }
    const git = gitExt.isActive ? gitExt.exports.getAPI(1) : (await gitExt.activate()).getAPI(1);
    const repo = git.repositories.find(r => r.rootUri.fsPath === cwd) ?? git.repositories[0];
    if (repo) {
      repo.inputBox.value = message;
      vscode.commands.executeCommand('workbench.view.scm');
    }
  });

  context.subscriptions.push(cmd);
}

function deactivate() {}

module.exports = { activate, deactivate };
