import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  SERVER_PORT, archOf, buildRunArgs, containerFolder, containerName, fromAuthority, normalizePath,
  parseConfig, substitute, toAuthority, DevContainerConfig, Vars,
} from './devcontainer';

const out = vscode.window.createOutputChannel('Null Dev Containers');

/**
 * Apps started from Explorer often lack Git's `sh` and Docker Desktop's `docker` on PATH,
 * so on Windows look in the default install dirs first.
 */
function tool(name: 'sh' | 'docker'): string {
  if (process.platform !== 'win32') { return name; }
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')];
  const rels = name === 'sh'
    ? ['Git/bin/sh.exe']
    : ['DockerDesktop/resources/bin/docker.exe', 'Docker/Docker/resources/bin/docker.exe'];
  for (const root of roots) {
    for (const rel of rels) {
      const f = root && path.join(root, rel);
      if (f && fs.existsSync(f)) { return f; }
    }
  }
  return name;
}

function run(cmd: string, args: string[], cwd?: string): Promise<string> {
  out.appendLine(`> ${cmd} ${args.join(' ')}`);
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { cwd, maxBuffer: 64 << 20 }, (err, stdout, stderr) => {
      if (stdout) { out.appendLine(stdout.trimEnd()); }
      if (stderr) { out.appendLine(stderr.trimEnd()); }
      if (err) { reject(new Error(`${path.basename(cmd)} ${args[0]} failed: ${(stderr || err.message).trim()}`)); } else { resolve(stdout); }
    }));
}

const dexec = (name: string, user: string, script: string) =>
  run(tool('docker'), ['exec', '-u', user, name, 'sh', '-c', script]);

function readConfig(local: string): DevContainerConfig {
  for (const f of [path.join(local, '.devcontainer', 'devcontainer.json'), path.join(local, '.devcontainer.json')]) {
    if (fs.existsSync(f)) { return parseConfig(fs.readFileSync(f, 'utf8')); }
  }
  throw new Error(`No devcontainer.json in ${local}`);
}

/** Downloads (once, cached) the Null server tarball for this build and arch. */
async function serverTarball(ctx: vscode.ExtensionContext, product: any, arch: string): Promise<string> {
  const keys: Record<string, string> = { ...product, os: 'linux', arch };
  const url = (product.serverDownloadUrlTemplate as string).replace(/\$\{(\w+)\}/g, (_, k) => keys[k] ?? '');
  const file = path.join(ctx.globalStorageUri.fsPath, `server-${product.release}-${arch}.tar.gz`);
  if (!fs.existsSync(file)) {
    out.appendLine(`Downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) { throw new Error(`Server download failed (${res.status}): ${url}`); }
    fs.mkdirSync(ctx.globalStorageUri.fsPath, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return file;
}

async function startContainer(ctx: vscode.ExtensionContext, authority: string): Promise<unknown> {
  const local = fromAuthority(authority);
  const cfg = readConfig(local);
  if (!cfg.image) { throw new Error('Only "image" based devcontainer.json files are supported'); }
  const vars: Vars = {
    localWorkspaceFolder: normalizePath(local),
    containerWorkspaceFolder: containerFolder(cfg, local),
    env: process.env,
  };
  const name = containerName(local);
  const user = cfg.remoteUser ?? 'root';
  const product = JSON.parse(fs.readFileSync(path.join(vscode.env.appRoot, 'product.json'), 'utf8'));
  const app = product.serverApplicationName as string;
  const home = `$HOME/${product.serverDataFolderName}`;
  const bin = `${home}/bin/${product.commit}`;

  if (cfg.initializeCommand) {
    const argv = typeof cfg.initializeCommand === 'string'
      ? [tool('sh'), '-c', substitute(cfg.initializeCommand, vars)] // Windows: Git for Windows' sh
      : cfg.initializeCommand.map((a) => substitute(a, vars));
    await run(argv[0], argv.slice(1), local);
  }

  const state = await run(tool('docker'), ['inspect', '-f', '{{.State.Running}}', name]).then((s) => s.trim(), () => 'missing');
  if (state === 'missing') { await run(tool('docker'), buildRunArgs(cfg, vars, name)); }
  else if (state !== 'true') { await run(tool('docker'), ['start', name]); }

  const installed = await dexec(name, user, `test -x "${bin}/bin/${app}"`).then(() => true, () => false);
  if (!installed) {
    const arch = archOf(await dexec(name, user, 'uname -m'));
    const tgz = await serverTarball(ctx, product, arch);
    await run(tool('docker'), ['cp', tgz, `${name}:/tmp/null-server.tar.gz`]);
    await dexec(name, 'root', 'chmod a+r /tmp/null-server.tar.gz');
    await dexec(name, user, `mkdir -p "${bin}" && tar xzf /tmp/null-server.tar.gz -C "${bin}"`);
    await dexec(name, 'root', 'rm -f /tmp/null-server.tar.gz');
  }

  // Extensions are installed once per container; edit the list → Rebuild Container.
  const exts = cfg.customizations?.vscode?.extensions ?? [];
  if (exts.length && !(await dexec(name, user, `test -e "${home}/dc-exts"`).then(() => true, () => false))) {
    for (const id of exts) {
      await dexec(name, user, `"${bin}/bin/${app}" --install-extension '${id}'`)
        .catch((e) => out.appendLine(`Could not install ${id}: ${e.message}`));
    }
    await dexec(name, user, `touch "${home}/dc-exts"`);
  }

  // Start the server unless the pid file points at a live process; the token persists across reconnects.
  const s = `D="${home}"; mkdir -p "$D"
[ -s "$D/dc-token" ] || head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \\n' > "$D/dc-token"
if ! { [ -s "$D/dc-pid" ] && kill -0 "$(cat "$D/dc-pid")" 2>/dev/null; }; then
  nohup "${bin}/bin/${app}" --host 0.0.0.0 --port ${SERVER_PORT} --connection-token "$(cat "$D/dc-token")" --accept-server-license-terms --telemetry-level off >"$D/dc.log" 2>&1 &
  echo $! > "$D/dc-pid"
fi
for i in $(seq 1 60); do grep -q 'listening on' "$D/dc.log" 2>/dev/null && break; sleep 1; done
grep -q 'listening on' "$D/dc.log" || { cat "$D/dc.log" >&2; exit 1; }
cat "$D/dc-token"`;
  const token = (await dexec(name, user, s)).trim().split('\n').pop()!;
  const port = (await run(tool('docker'), ['port', name, `${SERVER_PORT}/tcp`])).match(/127\.0\.0\.1:(\d+)/)?.[1];
  if (!port) { throw new Error('Could not find the published server port'); }
  return new (vscode as any).ResolvedAuthority('127.0.0.1', Number(port), token);
}

export function activate(ctx: vscode.ExtensionContext): void {
  // `resolvers` is a proposed API, hence the casts.
  ctx.subscriptions.push((vscode.workspace as any).registerRemoteAuthorityResolver('dev-container', {
    resolve: (authority: string) =>
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Starting dev container…' },
        () => startContainer(ctx, authority).catch((e) => { out.show(true); throw e; }),
      ),
  }));

  ctx.subscriptions.push(vscode.commands.registerCommand('null.devcontainer.reopen', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (folder?.scheme !== 'file') { return vscode.window.showErrorMessage('Open a local folder first.'); }
    try {
      const cfg = readConfig(folder.fsPath);
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.from({
        scheme: 'vscode-remote',
        authority: toAuthority(folder.fsPath),
        path: containerFolder(cfg, folder.fsPath),
      }));
    } catch (e: any) { vscode.window.showErrorMessage(e.message); }
  }));

  ctx.subscriptions.push(vscode.commands.registerCommand('null.devcontainer.rebuild', async () => {
    const authority = vscode.workspace.workspaceFolders?.[0]?.uri.authority;
    if (!authority?.startsWith('dev-container+')) { return vscode.window.showErrorMessage('Not in a dev container.'); }
    try {
      await run(tool('docker'), ['rm', '-f', containerName(fromAuthority(authority))]);
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    } catch (e: any) { vscode.window.showErrorMessage(e.message); }
  }));
}
