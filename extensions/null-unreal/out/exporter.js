"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PER_RUN = void 0;
exports.classifyEngineFailure = classifyEngineFailure;
exports.peekAsset = peekAsset;
exports.exportAssets = exportAssets;
const node_path_1 = require("node:path");
const cache_1 = require("./cache");
const commandLine_1 = require("./commandLine");
const exportFormat_1 = require("./exportFormat");
const lock_1 = require("./lock");
const logs_1 = require("./logs");
const packagePath_1 = require("./packagePath");
const uproject_1 = require("./uproject");
exports.MAX_PER_RUN = 50;
// The caller gets its engine version from Build.version: "5.8.4".
function engineVersion(engine, fs) {
    const file = node_path_1.win32.join(engine.root, 'Engine', 'Build', 'Build.version');
    try {
        const j = JSON.parse(fs.readFile(file) ?? '');
        return `${j.MajorVersion}.${j.MinorVersion}.${j.PatchVersion}`;
    }
    catch {
        throw new uproject_1.ResolveError(`could not read the engine version from ${file}`);
    }
}
// What the log says when no manifest appeared, i.e. the script never got as far as its first line.
function classifyEngineFailure(log, code) {
    if (log !== undefined && /commandlet[^\n]*(not found|unknown|could not be found)|(failed|unable|could not) to find[^\n]*commandlet/i.test(log)) {
        return 'the engine has no PythonScript commandlet: enable the Python plugin by adding { "Name": "PythonScriptPlugin", "Enabled": true } to the "Plugins" list of the .uproject';
    }
    if (log !== undefined && /Running Python script/.test(log)) {
        return 'the export script started but failed before writing its manifest';
    }
    return `the engine exited (code ${code ?? 'killed'}) before running the export script. If the project's editor modules are not built, run \`null-unreal build\` first`;
}
// The cache entry for one file if it is still valid, without starting the engine.
// ponytail: re-reads Build.version and the plugin folders on every call; memoize if peeks get hot.
function peekAsset(o, fs) {
    const st = fs.stat(o.file);
    if (!st)
        return undefined;
    try {
        const pkg = (0, packagePath_1.toPackagePath)(o.file, (0, packagePath_1.findMounts)(o.project.dir, fs));
        const cur = { engineVersion: engineVersion(o.engine, fs), sourceMtime: Math.floor(st.mtimeMs), sourceSize: st.size };
        const l = (0, cache_1.lookup)((0, cache_1.assetsDir)(o.project.dir), pkg, cur, fs);
        return l.state === 'hit' ? l.doc : undefined;
    }
    catch {
        return undefined; // an unmounted file or an unreadable engine is simply not cached
    }
}
async function exportAssets(o, d) {
    const version = engineVersion(o.engine, d.fs);
    const mounts = (0, packagePath_1.findMounts)(o.project.dir, d.fs);
    const files = new Set();
    for (const t of o.targets) {
        if (d.fs.isDirectory(t))
            for (const f of (0, packagePath_1.uassetsIn)(t, d.fs))
                files.add(f);
        else if (d.fs.stat(t))
            files.add(t);
        else
            throw new uproject_1.ResolveError(`no such file or folder: ${t}`);
    }
    const byPkg = new Map();
    for (const file of files) {
        const st = d.fs.stat(file);
        const pkg = (0, packagePath_1.toPackagePath)(file, mounts);
        byPkg.set(pkg, { file, pkg, cur: { engineVersion: version, sourceMtime: Math.floor(st.mtimeMs), sourceSize: st.size } });
    }
    if (byPkg.size === 0)
        throw new uproject_1.ResolveError('nothing to export: no .uasset files found');
    const assets = (0, cache_1.assetsDir)(o.project.dir);
    const outcomes = new Map();
    const fromCache = (it) => {
        const l = (0, cache_1.lookup)(assets, it.pkg, it.cur, d.fs);
        if (l.state !== 'hit')
            return false;
        outcomes.set(it.pkg, { package: it.pkg, status: 'hit', doc: l.doc });
        return true;
    };
    const result = { outcomes: [], code: 0, ran: false, timedOut: false, seconds: 0 };
    let pending = [...byPkg.values()].filter((it) => o.force || !fromCache(it));
    if (pending.length > 0) {
        const dir = node_path_1.win32.join(o.project.dir, 'Saved', 'NullUnreal');
        const lockFile = node_path_1.win32.join(dir, 'export.lock');
        const requestFile = node_path_1.win32.join(dir, `export-request-${d.lock.pid}.json`);
        const manifestFile = node_path_1.win32.join(dir, `export-manifest-${d.lock.pid}.json`);
        d.fs.mkdir(dir);
        await (0, lock_1.withLock)(lockFile, d.lock, async () => {
            // Another process may have exported these while we waited for the lock.
            if (!o.force)
                pending = pending.filter((it) => !fromCache(it));
            if (pending.length === 0)
                return;
            const log = (0, logs_1.openLog)(o.project.dir, 'export', d.now());
            if (log.path !== undefined)
                (0, logs_1.rotate)(o.project.dir, 'export');
            else
                result.logWarning = log.warning;
            result.logPath = log.path;
            result.ran = true;
            let noManifest;
            try {
                for (let i = 0; i < pending.length; i += exports.MAX_PER_RUN) {
                    const chunk = pending.slice(i, i + exports.MAX_PER_RUN);
                    const req = {
                        schema: exportFormat_1.SCHEMA,
                        engineVersion: version,
                        outputDir: assets,
                        manifest: manifestFile,
                        assets: chunk.map((it) => ({ package: it.pkg, ...it.cur })),
                    };
                    d.fs.remove(manifestFile);
                    d.fs.writeFile(requestFile, JSON.stringify(req));
                    const plan = (0, commandLine_1.buildPlan)('export', o.engine, o.project, { extraArgs: o.extraArgs, script: d.scriptPath, request: requestFile });
                    plan.timeoutSec = o.timeoutSec ?? 120 + 2 * chunk.length;
                    const r = await d.run(plan, log.path !== undefined ? log.stream : undefined, false);
                    result.seconds += r.seconds;
                    if (r.timedOut) {
                        result.timedOut = true;
                        result.code = 124;
                        result.message = `the engine did not finish within ${plan.timeoutSec}s and was killed; assets exported before that stay cached`;
                    }
                    const text = d.fs.readFile(manifestFile);
                    const manifest = text === undefined ? undefined : (0, exportFormat_1.parseManifest)(text);
                    if (!manifest && !r.timedOut)
                        noManifest = { code: r.code };
                    for (const it of chunk) {
                        const s = manifest?.[it.pkg];
                        if (s?.status === 'exported') {
                            const l = (0, cache_1.lookup)(assets, it.pkg, it.cur, d.fs);
                            outcomes.set(it.pkg, l.state === 'hit'
                                ? { package: it.pkg, status: 'exported', doc: l.doc }
                                : { package: it.pkg, status: 'failed', error: 'the engine reported success but wrote no valid cache entry' });
                        }
                        else if (s?.status === 'failed') {
                            outcomes.set(it.pkg, { package: it.pkg, status: 'failed', error: s.error });
                        }
                        else {
                            outcomes.set(it.pkg, { package: it.pkg, status: 'not exported' });
                        }
                    }
                    // ponytail: a crash, hang or missing manifest ends the export here; the next request exports what is left.
                    if (noManifest || result.timedOut || chunk.some((it) => outcomes.get(it.pkg)?.status === 'not exported'))
                        break;
                }
            }
            finally {
                if (log.path !== undefined)
                    await new Promise((done) => log.stream.end(done));
                d.fs.remove(requestFile);
                d.fs.remove(manifestFile);
            }
            if (noManifest) {
                result.code = 2;
                result.message = classifyEngineFailure(result.logPath ? d.fs.readFile(result.logPath) : undefined, noManifest.code);
            }
        });
    }
    for (const it of byPkg.values()) {
        result.outcomes.push(outcomes.get(it.pkg) ?? { package: it.pkg, status: 'not exported' });
    }
    if (result.code === 0 && result.outcomes.some((x) => x.status === 'failed' || x.status === 'not exported'))
        result.code = 1;
    return result;
}
//# sourceMappingURL=exporter.js.map