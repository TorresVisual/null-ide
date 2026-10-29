"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const devcontainer_1 = require("./devcontainer");
const out = vscode.window.createOutputChannel('Null Dev Containers');
/**
 * Apps started from Explorer often lack Git's `sh` and Docker Desktop's `docker` on PATH,
 * so on Windows look in the default install dirs first.
 */
function tool(name) {
    if (process.platform !== 'win32') {
        return name;
    }
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')];
    const rels = name === 'sh' ? ['Git/bin/sh.exe']
        : name === 'git' ? ['Git/cmd/git.exe']
            : ['DockerDesktop/resources/bin/docker.exe', 'Docker/Docker/resources/bin/docker.exe'];
    for (const root of roots) {
        for (const rel of rels) {
            const f = root && path.join(root, rel);
            if (f && fs.existsSync(f)) {
                return f;
            }
        }
    }
    return name;
}
function run(cmd, args, cwd) {
    out.appendLine(`> ${cmd} ${args.join(' ')}`);
    return new Promise((resolve, reject) => 
    // docker finds its credential helper (docker-credential-desktop) next to itself on PATH
    (0, child_process_1.execFile)(cmd, args, { cwd, maxBuffer: 64 << 20, env: path.isAbsolute(cmd) ? { ...process.env, PATH: `${path.dirname(cmd)}${path.delimiter}${process.env.PATH ?? ''}` } : process.env }, (err, stdout, stderr) => {
        if (stdout) {
            out.appendLine(stdout.trimEnd());
        }
        if (stderr) {
            out.appendLine(stderr.trimEnd());
        }
        if (err) {
            reject(new Error(`${path.basename(cmd)} ${args[0]} failed: ${(stderr || err.message).trim()}`));
        }
        else {
            resolve(stdout);
        }
    }));
}
const dexec = (name, user, script) => run(tool('docker'), ['exec', '-u', user, name, 'sh', '-c', script]);
function readConfig(local) {
    for (const f of [path.join(local, '.devcontainer', 'devcontainer.json'), path.join(local, '.devcontainer.json')]) {
        if (fs.existsSync(f)) {
            return (0, devcontainer_1.parseConfig)(fs.readFileSync(f, 'utf8'));
        }
    }
    throw new Error(`No devcontainer.json in ${local}`);
}
/** Downloads (once, cached) the Null server tarball for this build and arch. */
async function serverTarball(ctx, product, arch) {
    const keys = { ...product, os: 'linux', arch };
    const url = product.serverDownloadUrlTemplate.replace(/\$\{(\w+)\}/g, (_, k) => keys[k] ?? '');
    const file = path.join(ctx.globalStorageUri.fsPath, `server-${product.release}-${arch}.tar.gz`);
    if (!fs.existsSync(file)) {
        out.appendLine(`Downloading ${url}`);
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Server download failed (${res.status}): ${url}`);
        }
        fs.mkdirSync(ctx.globalStorageUri.fsPath, { recursive: true });
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    return file;
}
/**
 * Copies the host's null-accounts SSH keys into the container user's ~/.ssh (ssh and ssh-keygen refuse keys with
 * the bind-mount's permissions) and returns the GIT_CONFIG_* overrides that point the repo's host paths at them.
 */
async function copyAccountKeys(name, user, local) {
    const hostDir = path.join(os.homedir(), '.ssh', 'null-accounts');
    if (!fs.existsSync(hostDir)) {
        return {};
    }
    const cfgOf = (key) => run(tool('git'), ['-C', local, 'config', '--local', '--get', key]).then((s) => s.trim(), () => '');
    const cHome = (await dexec(name, user, 'echo $HOME')).trim();
    if (!cHome.startsWith('/')) {
        throw new Error(`Unexpected home directory for ${user}: "${cHome}"`);
    }
    const target = `${cHome}/.ssh/null-accounts`;
    const env = (0, devcontainer_1.gitKeyOverrides)(hostDir, target, { sshCommand: await cfgOf('core.sshCommand'), signingKey: await cfgOf('user.signingkey') });
    if (!Object.keys(env).length) {
        return {};
    }
    await run(tool('docker'), ['cp', hostDir + path.sep + '.', `${name}:/tmp/null-accounts-keys`]);
    await dexec(name, 'root', `U=$(id -u ${user}) && G=$(id -g ${user}) && rm -rf "${target}" && mkdir -p "${cHome}/.ssh" \
&& mv /tmp/null-accounts-keys "${target}" && chown -R $U:$G "${cHome}/.ssh" && chmod 700 "${cHome}/.ssh" "${target}" \
&& find "${target}" -type f -exec chmod 600 {} +`);
    return env;
}
async function startContainer(ctx, authority) {
    const local = (0, devcontainer_1.fromAuthority)(authority);
    const cfg = readConfig(local);
    if (!cfg.image) {
        throw new Error('Only "image" based devcontainer.json files are supported');
    }
    const vars = {
        localWorkspaceFolder: (0, devcontainer_1.normalizePath)(local),
        containerWorkspaceFolder: (0, devcontainer_1.containerFolder)(cfg, local),
        env: process.env,
    };
    const name = (0, devcontainer_1.containerName)(local);
    const user = cfg.remoteUser ?? 'root';
    const product = JSON.parse(fs.readFileSync(path.join(vscode.env.appRoot, 'product.json'), 'utf8'));
    const app = product.serverApplicationName;
    const home = `$HOME/${product.serverDataFolderName}`;
    const bin = `${home}/bin/${product.commit}`;
    if (cfg.initializeCommand) {
        const argv = typeof cfg.initializeCommand === 'string'
            ? [tool('sh'), '-c', (0, devcontainer_1.substitute)(cfg.initializeCommand, vars)] // Windows: Git for Windows' sh
            : cfg.initializeCommand.map((a) => (0, devcontainer_1.substitute)(a, vars));
        await run(argv[0], argv.slice(1), local);
    }
    const state = await run(tool('docker'), ['inspect', '-f', '{{.State.Running}}', name]).then((s) => s.trim(), () => 'missing');
    if (state === 'missing') {
        await run(tool('docker'), (0, devcontainer_1.buildRunArgs)(cfg, vars, name));
    }
    else if (state !== 'true') {
        await run(tool('docker'), ['start', name]);
    }
    const installed = await dexec(name, user, `test -x "${bin}/bin/${app}"`).then(() => true, () => false);
    if (!installed) {
        const arch = (0, devcontainer_1.archOf)(await dexec(name, user, 'uname -m'));
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
    const gitEnv = await copyAccountKeys(name, user, local);
    // Start the server unless the pid file points at a live process; the token persists across reconnects.
    // The git overrides are the server's environment, so a changed set restarts it.
    const s = `D="${home}"; mkdir -p "$D"
cat > "$D/dc-env.new" <<'NULL_ENV_EOF'
${(0, devcontainer_1.envFile)(gitEnv)}NULL_ENV_EOF
if ! cmp -s "$D/dc-env.new" "$D/dc-env" 2>/dev/null; then
  [ -s "$D/dc-pid" ] && kill "$(cat "$D/dc-pid")" 2>/dev/null && sleep 2
  rm -f "$D/dc-pid"; mv "$D/dc-env.new" "$D/dc-env"
fi
. "$D/dc-env"
[ -s "$D/dc-token" ] || head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \\n' > "$D/dc-token"
if ! { [ -s "$D/dc-pid" ] && kill -0 "$(cat "$D/dc-pid")" 2>/dev/null; }; then
  nohup "${bin}/bin/${app}" --host 0.0.0.0 --port ${devcontainer_1.SERVER_PORT} --connection-token "$(cat "$D/dc-token")" --accept-server-license-terms --telemetry-level off >"$D/dc.log" 2>&1 &
  echo $! > "$D/dc-pid"
fi
for i in $(seq 1 60); do grep -q 'listening on' "$D/dc.log" 2>/dev/null && break; sleep 1; done
grep -q 'listening on' "$D/dc.log" || { cat "$D/dc.log" >&2; exit 1; }
cat "$D/dc-token"`;
    const token = (await dexec(name, user, s)).trim().split('\n').pop();
    const port = (await run(tool('docker'), ['port', name, `${devcontainer_1.SERVER_PORT}/tcp`])).match(/127\.0\.0\.1:(\d+)/)?.[1];
    if (!port) {
        throw new Error('Could not find the published server port');
    }
    return new vscode.ResolvedAuthority('127.0.0.1', Number(port), token);
}
function activate(ctx) {
    // `resolvers` is a proposed API, hence the casts.
    ctx.subscriptions.push(vscode.workspace.registerRemoteAuthorityResolver('dev-container', {
        resolve: (authority) => vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Starting dev container…' }, () => startContainer(ctx, authority).catch((e) => { out.show(true); throw e; })),
    }));
    ctx.subscriptions.push(vscode.commands.registerCommand('null.devcontainer.reopen', async () => {
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (folder?.scheme !== 'file') {
            return vscode.window.showErrorMessage('Open a local folder first.');
        }
        try {
            const cfg = readConfig(folder.fsPath);
            await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.from({
                scheme: 'vscode-remote',
                authority: (0, devcontainer_1.toAuthority)(folder.fsPath),
                path: (0, devcontainer_1.containerFolder)(cfg, folder.fsPath),
            }));
        }
        catch (e) {
            vscode.window.showErrorMessage(e.message);
        }
    }));
    ctx.subscriptions.push(vscode.commands.registerCommand('null.devcontainer.rebuild', async () => {
        const authority = vscode.workspace.workspaceFolders?.[0]?.uri.authority;
        if (!authority?.startsWith('dev-container+')) {
            return vscode.window.showErrorMessage('Not in a dev container.');
        }
        try {
            await run(tool('docker'), ['rm', '-f', (0, devcontainer_1.containerName)((0, devcontainer_1.fromAuthority)(authority))]);
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
        catch (e) {
            vscode.window.showErrorMessage(e.message);
        }
    }));
}
//# sourceMappingURL=extension.js.map