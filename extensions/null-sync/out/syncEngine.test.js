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
const node_test_1 = require("node:test");
const assert = __importStar(require("node:assert/strict"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const jsonc_parser_1 = require("jsonc-parser");
const fakeGist_1 = require("./fakeGist");
const testDevice_1 = require("./testDevice");
(0, node_test_1.after)(testDevice_1.cleanup);
const PASS = 'correct horse battery staple';
const SETTINGS = '{\n  "editor.fontSize": 14,\n  "git.path": "C:\\\\git.exe"\n}\n';
/** Two devices that already hold exactly `files` and agree with the cloud. */
async function synced(files) {
    const gist = new fakeGist_1.FakeGist();
    const a = new testDevice_1.Device(gist);
    const b = new testDevice_1.Device(gist);
    for (const [file, text] of Object.entries(files)) {
        a.write(file, text);
        b.write(file, text);
    }
    assert.equal((await a.enable(PASS)).ok, true);
    assert.equal((await b.enable(PASS, 'cloud')).ok, true);
    assert.equal(a.status.state, 'idle');
    assert.equal(b.status.state, 'idle');
    return { gist, a, b, id: gist.ids()[0] };
}
(0, node_test_1.describe)('first sync', () => {
    (0, node_test_1.it)('a new device takes the cloud data but keeps its own excluded settings', async () => {
        const gist = new fakeGist_1.FakeGist();
        const a = new testDevice_1.Device(gist);
        const b = new testDevice_1.Device(gist);
        a.write('settings.json', '{\n  "editor.fontSize": 14,\n  "git.path": "C:\\\\a\\\\git.exe"\n}\n');
        assert.equal((await a.enable(PASS)).ok, true);
        b.write('settings.json', '{\n  "git.path": "D:\\\\b\\\\git.exe"\n}\n');
        assert.equal((await b.enable(PASS, 'cloud')).ok, true);
        assert.deepEqual((0, jsonc_parser_1.parse)(b.read('settings.json')), { 'editor.fontSize': 14, 'git.path': 'D:\\b\\git.exe' });
        assert.equal(b.backups('settings.json.').length, 1, 'the old local file is backed up');
        assert.deepEqual((0, jsonc_parser_1.parse)(a.read('settings.json')), { 'editor.fontSize': 14, 'git.path': 'C:\\a\\git.exe' });
    });
    (0, node_test_1.it)('"use this device" makes the cloud match this device', async () => {
        const { gist, a } = await synced({ 'keybindings.json': '[]\n' });
        const c = new testDevice_1.Device(gist);
        c.write('keybindings.json', '[1]\n');
        assert.equal((await c.enable(PASS, 'device')).ok, true);
        await a.run();
        assert.equal(a.read('keybindings.json'), '[1]\n');
        assert.equal(c.status.state, 'idle');
    });
    (0, node_test_1.it)('"decide per file" leaves the conflict for the user and changes nothing', async () => {
        const { gist } = await synced({ 'keybindings.json': '[]\n' });
        const c = new testDevice_1.Device(gist);
        c.write('keybindings.json', '[1]\n');
        assert.equal((await c.enable(PASS, 'each')).ok, true);
        assert.deepEqual(c.status.conflicts, [{ file: 'keybindings.json', category: 'keybindings' }]);
        assert.equal(c.status.state, 'needsAttention');
        assert.equal(c.read('keybindings.json'), '[1]\n');
    });
    (0, node_test_1.it)('a device with no snippets simply receives them', async () => {
        const gist = new fakeGist_1.FakeGist();
        const a = new testDevice_1.Device(gist);
        a.write('snippets/cpp.json', '{}\n');
        assert.equal((await a.enable(PASS)).ok, true);
        const b = new testDevice_1.Device(gist);
        assert.equal((await b.enable(PASS, 'each')).ok, true);
        assert.equal(b.read('snippets/cpp.json'), '{}\n');
        assert.equal(b.status.state, 'idle');
    });
});
(0, node_test_1.describe)('syncing edits', () => {
    (0, node_test_1.it)('an edit on one device reaches the other, and nothing ping-pongs', async () => {
        const { gist, a, b, id } = await synced({ 'settings.json': SETTINGS });
        const before = gist.revisionCount(id);
        for (let i = 0; i < 2; i++) {
            await a.run();
            await b.run();
        }
        assert.equal(gist.revisionCount(id), before, 'idle devices push nothing');
        b.write('settings.json', SETTINGS.replace('14', '16'));
        await b.run();
        await a.run();
        assert.deepEqual((0, jsonc_parser_1.parse)(a.read('settings.json')), { 'editor.fontSize': 16, 'git.path': 'C:\\git.exe' });
        const afterEdit = gist.revisionCount(id);
        for (let i = 0; i < 2; i++) {
            await a.run();
            await b.run();
        }
        assert.equal(gist.revisionCount(id), afterEdit, 'no further pushes');
        assert.equal(a.status.state, 'idle');
        assert.equal(b.status.state, 'idle');
    });
    (0, node_test_1.it)('editing only an excluded setting syncs nothing', async () => {
        const { gist, a, id } = await synced({ 'settings.json': SETTINGS });
        const before = gist.revisionCount(id);
        a.write('settings.json', SETTINGS.replace('C:\\\\git.exe', 'D:\\\\other.exe'));
        await a.run();
        assert.equal(gist.revisionCount(id), before);
    });
    (0, node_test_1.it)('a secret-looking setting never reaches the other device', async () => {
        const { a, b } = await synced({ 'settings.json': '{\n  "editor.fontSize": 14\n}\n' });
        a.write('settings.json', '{\n  "editor.fontSize": 18,\n  "my.apiToken": "s3cret"\n}\n');
        await a.run();
        await b.run();
        assert.equal(b.read('settings.json').includes('s3cret'), false);
        assert.deepEqual((0, jsonc_parser_1.parse)(b.read('settings.json')), { 'editor.fontSize': 18 });
    });
    (0, node_test_1.it)('a new snippet file is added on the other device', async () => {
        const { a, b } = await synced({});
        a.write('snippets/rust.json', '{"a":1}\n');
        await a.run();
        await b.run();
        assert.equal(b.read('snippets/rust.json'), '{"a":1}\n');
    });
});
(0, node_test_1.describe)('conflicts', () => {
    (0, node_test_1.it)('a file edited on both devices is a conflict that no run resolves silently', async () => {
        const { a, b } = await synced({ 'keybindings.json': '[]\n' });
        a.write('keybindings.json', '[1]\n');
        b.write('keybindings.json', '[2]\n');
        await a.run();
        await b.run();
        assert.deepEqual(b.status.conflicts, [{ file: 'keybindings.json', category: 'keybindings' }]);
        assert.equal(b.status.state, 'needsAttention');
        assert.equal(b.read('keybindings.json'), '[2]\n');
        await b.run();
        assert.equal(b.read('keybindings.json'), '[2]\n', 'still untouched on a later run');
        assert.equal(b.status.conflicts.length, 1);
    });
});
(0, node_test_1.describe)('connectivity and credentials', () => {
    (0, node_test_1.it)('offline edits are kept and pushed when the connection returns', async () => {
        const { gist, a, b } = await synced({ 'keybindings.json': '[]\n' });
        gist.offline = true;
        a.write('keybindings.json', '[1]\n');
        await a.run();
        assert.equal(a.status.state, 'offline');
        assert.match(a.status.message, /ENOTFOUND/);
        assert.equal(a.read('keybindings.json'), '[1]\n');
        gist.offline = false;
        await a.run();
        await b.run();
        assert.equal(b.read('keybindings.json'), '[1]\n');
        assert.equal(a.status.state, 'idle');
    });
    (0, node_test_1.it)('a wrong saved passphrase is an error and writes nothing locally', async () => {
        const { a, b } = await synced({ 'keybindings.json': '[]\n' });
        b.passphrase = 'some other passphrase';
        a.write('keybindings.json', '[1]\n');
        await a.run();
        await b.run();
        assert.equal(b.status.state, 'error');
        assert.match(b.status.message, /passphrase/);
        assert.equal(b.read('keybindings.json'), '[]\n');
    });
    (0, node_test_1.it)('a deleted gist asks to set up again instead of recreating it', async () => {
        const { gist, a, id } = await synced({ 'keybindings.json': '[]\n' });
        gist.delete(id);
        await a.run();
        assert.equal(a.status.state, 'signedOut');
        assert.match(a.status.message, /no longer exists/);
        assert.equal(gist.ids().length, 0, 'a background run must not create a new gist');
    });
    (0, node_test_1.it)('is disabled when switched off and signedOut when never set up', async () => {
        const d = new testDevice_1.Device(new fakeGist_1.FakeGist());
        d.enabled = false;
        await d.run();
        assert.equal(d.status.state, 'disabled');
        d.enabled = true;
        await d.run();
        assert.equal(d.status.state, 'signedOut');
    });
    (0, node_test_1.it)('a held cross-window lock skips a background run quietly and tells an interactive one', async () => {
        const { gist, a, id } = await synced({ 'keybindings.json': '[]\n' });
        a.locked = true;
        a.write('keybindings.json', '[1]\n');
        const before = gist.revisionCount(id);
        await a.run();
        assert.equal(gist.revisionCount(id), before);
        assert.equal(a.status.state, 'idle');
        await a.syncNow();
        assert.match(a.status.message, /Another window/);
        assert.equal(gist.revisionCount(id), before);
    });
    (0, node_test_1.it)('tells listeners about every status change', async () => {
        const { a } = await synced({});
        const seen = [];
        const sub = a.engine.onDidChange(() => seen.push(a.status.state));
        await a.run();
        sub.dispose();
        await a.run();
        assert.deepEqual(seen, ['syncing', 'idle']);
    });
});
(0, node_test_1.describe)('deletions', () => {
    (0, node_test_1.it)('a missing settings.json is restored from the cloud and never deleted there', async () => {
        const S = '{\n  "editor.fontSize": 14\n}\n';
        const { gist, a, id } = await synced({ 'settings.json': S });
        const before = gist.revisionCount(id);
        a.remove('settings.json');
        await a.run();
        assert.equal(a.read('settings.json'), S);
        assert.equal(gist.revisionCount(id), before);
    });
    (0, node_test_1.it)('a device that never had a keybindings.json pushes nothing for it', async () => {
        const { gist, a, b, id } = await synced({});
        const before = gist.revisionCount(id);
        await a.run();
        await b.run();
        assert.equal(a.read('keybindings.json'), null);
        assert.equal(gist.revisionCount(id), before);
        assert.equal(a.status.state, 'idle');
    });
    (0, node_test_1.it)('a deleted snippet is deleted on the other device, with a backup', async () => {
        const { a, b } = await synced({ 'snippets/a.json': '{"a":1}\n' });
        a.remove('snippets/a.json');
        await a.run();
        await b.run();
        assert.equal(b.read('snippets/a.json'), null);
        assert.equal(b.backups('snippets__a.json.').length, 1);
        assert.equal(b.status.state, 'idle');
    });
});
(0, node_test_1.describe)('unsaved edits', () => {
    (0, node_test_1.it)('a file open with unsaved edits is skipped and applied on the next run', async () => {
        const { a, b } = await synced({ 'keybindings.json': '[]\n' });
        a.write('keybindings.json', '[1]\n');
        await a.run();
        b.dirty.add('keybindings.json');
        await b.run();
        assert.deepEqual(b.status.pending, ['keybindings.json']);
        assert.equal(b.status.state, 'needsAttention');
        assert.equal(b.read('keybindings.json'), '[]\n');
        b.dirty.clear();
        await b.run();
        assert.equal(b.read('keybindings.json'), '[1]\n');
        assert.deepEqual(b.status.pending, []);
        assert.equal(b.status.state, 'idle');
    });
    (0, node_test_1.it)('an interactive run asks, and only overwrites when told to', async () => {
        const { a, b } = await synced({ 'keybindings.json': '[]\n' });
        a.write('keybindings.json', '[1]\n');
        await a.run();
        b.dirty.add('keybindings.json');
        await b.syncNow();
        assert.deepEqual(b.status.pending, ['keybindings.json']);
        b.overwrite = true;
        await b.syncNow();
        assert.equal(b.read('keybindings.json'), '[1]\n');
        assert.deepEqual(b.status.pending, []);
    });
});
(0, node_test_1.describe)('bad data', () => {
    (0, node_test_1.it)('one corrupt remote file is reported while the rest still syncs, and nothing is written from it', async () => {
        const { gist, a, b, id } = await synced({ 'keybindings.json': '[]\n', 'snippets/a.json': '{}\n' });
        gist.tamper(id, 'keybindings.json.enc', '{"v":1,"iv":"AAAA","tag":"AAAA","data":"AAAA"}');
        a.write('snippets/a.json', '{"x":1}\n');
        a.write('keybindings.json', '[9]\n');
        await a.run();
        await b.run();
        assert.equal(a.status.state, 'error');
        assert.match(a.status.message, /keybindings\.json\.enc/);
        assert.equal(a.read('keybindings.json'), '[9]\n', 'an undecryptable remote file is never overwritten');
        assert.equal(b.read('snippets/a.json'), '{"x":1}\n');
        assert.equal(b.read('keybindings.json'), '[]\n');
        assert.equal(b.status.state, 'error');
    });
    (0, node_test_1.it)('a remote file name that tries to leave the snippets folder is ignored', async () => {
        const { gist, b, id } = await synced({});
        gist.tamper(id, 'snippets__..\\..\\evil.json.enc', 'x');
        gist.tamper(id, 'tasks.json.enc', 'x');
        await b.run();
        assert.equal(b.status.state, 'idle');
        assert.equal(b.read('tasks.json'), null);
    });
    (0, node_test_1.it)('an invalid local settings.json is reported and not uploaded', async () => {
        const { gist, a, id } = await synced({ 'settings.json': '{\n  "a": 1\n}\n' });
        const before = gist.revisionCount(id);
        a.write('settings.json', '{ "a": ');
        await a.run();
        assert.equal(a.status.state, 'error');
        assert.match(a.status.message, /settings\.json is not valid JSON/);
        assert.equal(gist.revisionCount(id), before);
    });
    (0, node_test_1.it)('an empty settings.json, comments and trailing commas are all fine', async () => {
        const { a, b } = await synced({ 'settings.json': '' });
        a.write('settings.json', '// my settings\n{\n  "a": 1, // one\n}\n');
        await a.run();
        await b.run();
        assert.equal(b.status.state, 'idle');
        assert.deepEqual((0, jsonc_parser_1.parse)(b.read('settings.json')), { a: 1 });
        assert.match(b.read('settings.json'), /\/\/ my settings/);
    });
    (0, node_test_1.it)('a file over 900 KB is reported and not uploaded', async () => {
        const { gist, a, id } = await synced({});
        a.write('snippets/big.json', 'x'.repeat(900_001));
        await a.run();
        assert.equal(a.status.state, 'error');
        assert.match(a.status.message, /too large/);
        assert.equal(Object.keys(gist.files(id)).some((n) => n.includes('big')), false);
    });
});
(0, node_test_1.describe)('categories', () => {
    (0, node_test_1.it)('a disabled category is neither uploaded nor applied', async () => {
        const { a, b } = await synced({ 'keybindings.json': '[]\n', 'snippets/a.json': '{}\n' });
        a.categories.snippets = false;
        b.categories.keybindings = false;
        a.write('snippets/a.json', '{"x":1}\n');
        a.write('keybindings.json', '[1]\n');
        await a.run();
        await b.run();
        assert.equal(b.read('snippets/a.json'), '{}\n', 'a never uploaded the snippet');
        assert.equal(b.read('keybindings.json'), '[]\n', 'b does not apply keybindings');
    });
});
(0, node_test_1.describe)('resolving conflicts', () => {
    async function conflicted() {
        const s = await synced({ 'keybindings.json': '[]\n' });
        s.a.write('keybindings.json', '[1]\n');
        s.b.write('keybindings.json', '[2]\n');
        await s.a.run();
        await s.b.run();
        assert.equal(s.b.status.conflicts.length, 1);
        return s;
    }
    (0, node_test_1.it)('shows the remote text for a diff, and nothing for a file that is not there', async () => {
        const { b } = await conflicted();
        assert.equal(await b.engine.previewRemote('keybindings.json'), '[1]\n');
        assert.equal(await b.engine.previewRemote('snippets/none.json'), undefined);
    });
    (0, node_test_1.it)('taking theirs applies the remote file and keeps this device\'s version as a backup', async () => {
        const { b } = await conflicted();
        await b.engine.resolve('keybindings.json', 'theirs');
        assert.equal(b.read('keybindings.json'), '[1]\n');
        const backups = b.backups('keybindings.json.');
        assert.equal(backups.length, 1);
        assert.equal(fs.readFileSync(path.join(b.backupsDir, backups[0]), 'utf8'), '[2]\n');
        assert.equal(b.status.state, 'idle');
        assert.deepEqual(b.status.conflicts, []);
        await b.run();
        assert.equal(b.read('keybindings.json'), '[1]\n');
    });
    (0, node_test_1.it)('keeping mine uploads this device\'s file so the other device receives it', async () => {
        const { a, b } = await conflicted();
        await b.engine.resolve('keybindings.json', 'mine');
        assert.equal(b.status.state, 'idle');
        await a.run();
        assert.equal(a.read('keybindings.json'), '[2]\n');
    });
    (0, node_test_1.it)('resolving one conflict leaves the others', async () => {
        const { a, b } = await synced({ 'keybindings.json': '[]\n', 'snippets/a.json': '{}\n' });
        a.write('keybindings.json', '[1]\n');
        a.write('snippets/a.json', '{"a":1}\n');
        b.write('keybindings.json', '[2]\n');
        b.write('snippets/a.json', '{"b":1}\n');
        await a.run();
        await b.run();
        assert.equal(b.status.conflicts.length, 2);
        await b.engine.resolve('keybindings.json', 'theirs');
        assert.deepEqual(b.status.conflicts, [{ file: 'snippets/a.json', category: 'snippets' }]);
        assert.equal(b.status.state, 'needsAttention');
    });
});
(0, node_test_1.describe)('restore', () => {
    (0, node_test_1.it)('lists revisions newest first and rolls this device and the cloud back', async () => {
        const { a, b } = await synced({ 'keybindings.json': '[1]\n' });
        a.write('keybindings.json', '[2]\n');
        await a.run();
        await b.run();
        assert.equal(b.read('keybindings.json'), '[2]\n');
        const revisions = await a.engine.revisions();
        assert.equal(revisions?.length, 3, 'manifest, first upload, edit');
        await a.engine.restore(revisions[1].sha);
        assert.equal(a.read('keybindings.json'), '[1]\n');
        assert.equal(a.backups('keybindings.json.').length, 1);
        assert.equal(a.status.state, 'idle');
        await b.run();
        assert.equal(b.read('keybindings.json'), '[1]\n');
        assert.equal(b.status.state, 'idle');
    });
    (0, node_test_1.it)('reports an unknown revision instead of changing anything', async () => {
        const { a } = await synced({ 'keybindings.json': '[1]\n' });
        await a.engine.restore('v99');
        assert.equal(a.read('keybindings.json'), '[1]\n');
        assert.equal(a.status.state, 'error');
        assert.match(a.status.message, /revision/);
    });
});
(0, node_test_1.describe)('stop', () => {
    (0, node_test_1.it)('forgets this device but leaves its files and, by default, the cloud copy', async () => {
        const { gist, a, id } = await synced({ 'keybindings.json': '[1]\n' });
        assert.deepEqual(await a.engine.stop(false), { ok: true });
        assert.equal(a.state, undefined);
        assert.equal(a.passphrase, undefined);
        assert.equal(a.read('keybindings.json'), '[1]\n');
        assert.equal(gist.has(id), true);
        assert.equal(a.status.state, 'disabled');
        await a.run();
        assert.equal(a.status.state, 'signedOut', 'running again asks to set up');
    });
    (0, node_test_1.it)('can also delete the cloud copy, and other devices then ask to set up again', async () => {
        const { gist, a, b, id } = await synced({ 'keybindings.json': '[1]\n' });
        assert.deepEqual(await a.engine.stop(true), { ok: true });
        assert.equal(gist.has(id), false);
        await b.run();
        assert.equal(b.status.state, 'signedOut');
        assert.match(b.status.message, /no longer exists/);
    });
    (0, node_test_1.it)('keeps everything if the cloud copy cannot be deleted', async () => {
        const { gist, a } = await synced({ 'keybindings.json': '[1]\n' });
        gist.offline = true;
        const result = await a.engine.stop(true);
        assert.equal(result.ok, false);
        assert.notEqual(a.state, undefined);
        assert.notEqual(a.passphrase, undefined);
    });
});
(0, node_test_1.describe)('extension list', () => {
    (0, node_test_1.it)('an interactive run installs what another device added; a background run only reports it', async () => {
        const { a, b } = await synced({});
        a.installed.add('pub.x');
        a.installed.add('pub.y');
        b.installed.add('pub.y');
        await a.syncNow();
        await b.run();
        assert.deepEqual(b.status.pendingInstalls, ['pub.x']);
        assert.equal(b.status.state, 'needsAttention');
        assert.equal(b.installed.has('pub.x'), false, 'a background run never installs');
        await b.syncNow();
        assert.equal(b.installed.has('pub.x'), true);
        assert.deepEqual(b.status.pendingInstalls, []);
        assert.equal(b.status.state, 'idle');
    });
    (0, node_test_1.it)('a removal elsewhere is reported but never applied, and uninstallRemoved applies it without re-uploading it', async () => {
        const { gist, a, b, id } = await synced({});
        a.installed.add('pub.x');
        a.installed.add('pub.y');
        await a.syncNow();
        await b.syncNow();
        a.installed.delete('pub.y');
        await a.syncNow();
        await b.run();
        assert.deepEqual(b.status.pendingRemovals, ['pub.y']);
        assert.equal(b.installed.has('pub.y'), true);
        const before = gist.revisionCount(id);
        await b.run();
        assert.equal(gist.revisionCount(id), before, 'reporting a removal pushes nothing');
        await b.engine.uninstallRemoved('pub.y');
        assert.equal(b.installed.has('pub.y'), false);
        assert.deepEqual(b.status.pendingRemovals, []);
        assert.equal(b.status.state, 'idle');
        await b.run();
        await a.run();
        assert.equal(gist.revisionCount(id), before);
        assert.equal(b.status.state, 'idle');
    });
    (0, node_test_1.it)('a failed install is reported and stays pending until it works', async () => {
        const { a, b } = await synced({});
        a.installed.add('pub.ok');
        a.installed.add('pub.bad');
        await a.syncNow();
        b.failing.add('pub.bad');
        await b.syncNow();
        assert.equal(b.installed.has('pub.ok'), true);
        assert.equal(b.status.state, 'error');
        assert.match(b.status.message, /Could not install pub\.bad/);
        assert.deepEqual(b.status.pendingInstalls, ['pub.bad']);
        b.failing.clear();
        await b.syncNow();
        assert.equal(b.installed.has('pub.bad'), true);
        assert.equal(b.status.state, 'idle');
    });
    (0, node_test_1.it)('an unreadable installed list skips the extension sync instead of removing everything', async () => {
        const { gist, a, id } = await synced({});
        a.installed.add('pub.x');
        await a.syncNow();
        const before = gist.revisionCount(id);
        a.manifestBroken = true;
        await a.syncNow();
        assert.equal(a.status.state, 'error');
        assert.match(a.status.message, /installed extensions/);
        assert.equal(gist.revisionCount(id), before);
    });
    (0, node_test_1.it)('a corrupt remote extension list is reported and left alone', async () => {
        const { gist, a, id } = await synced({});
        a.installed.add('pub.x');
        gist.tamper(id, 'extensions.json.enc', '{"v":1,"iv":"AAAA","tag":"AAAA","data":"AAAA"}');
        const before = gist.revisionCount(id);
        await a.syncNow();
        assert.equal(a.status.state, 'error');
        assert.match(a.status.message, /extensions\.json\.enc/);
        assert.equal(gist.revisionCount(id), before);
    });
    (0, node_test_1.it)('is not synced when its category is off', async () => {
        const { gist, a, id } = await synced({});
        a.categories.extensions = false;
        a.installed.add('pub.x');
        const before = gist.revisionCount(id);
        await a.syncNow();
        assert.equal(gist.revisionCount(id), before);
    });
});
(0, node_test_1.describe)('review fixes', () => {
    (0, node_test_1.it)('an unreadable snippets folder never deletes the synced snippets', async () => {
        const { gist, a, b, id } = await synced({ 'snippets/a.json': '{"a":1}\n' });
        const before = gist.revisionCount(id);
        const original = fs.promises.readdir;
        node_test_1.mock.method(fs.promises, 'readdir', async (...args) => {
            if (String(args[0]).endsWith('snippets'))
                throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
            return original(...args);
        });
        try {
            await a.run();
        }
        finally {
            node_test_1.mock.restoreAll();
        }
        assert.equal(a.status.state, 'error');
        assert.equal(gist.revisionCount(id), before, 'nothing is pushed or deleted remotely');
        await b.run();
        assert.equal(b.read('snippets/a.json'), '{"a":1}\n');
    });
    (0, node_test_1.it)('a corrupt remote file says how to start it over', async () => {
        const { gist, a, id } = await synced({ 'keybindings.json': '[]\n' });
        gist.tamper(id, 'keybindings.json.enc', '{"v":1,"iv":"AAAA","tag":"AAAA","data":"AAAA"}');
        await a.run();
        assert.match(a.status.message, /delete keybindings\.json\.enc from the sync Gist/);
    });
    (0, node_test_1.it)('uninstalling a removed extension waits for a running sync instead of overwriting its state', async () => {
        const { a, b } = await synced({});
        a.installed.add('pub.y');
        await a.syncNow();
        await b.syncNow();
        a.installed.delete('pub.y');
        await a.syncNow();
        await b.run();
        assert.deepEqual(b.status.pendingRemovals, ['pub.y']);
        let release;
        b.uninstallGate = new Promise((resolve) => { release = resolve; });
        const uninstall = b.engine.uninstallRemoved('pub.y');
        b.write('keybindings.json', '[7]\n');
        const run = b.run();
        await new Promise((resolve) => setTimeout(resolve, 1500));
        release();
        await Promise.all([uninstall, run]);
        assert.equal(b.installed.has('pub.y'), false);
        assert.equal(b.state.lastSyncedAt, b.status.lastSyncedAt, 'the later sync result was not overwritten by a stale copy');
        assert.equal(b.status.state, 'idle');
    });
    (0, node_test_1.it)('stop waits for the cross-window lock like any other change of state', async () => {
        const { a } = await synced({ 'keybindings.json': '[1]\n' });
        a.locked = true;
        const result = await a.engine.stop(false);
        assert.equal(result.ok, false);
        assert.match(!result.ok ? result.message : '', /Another window/);
        assert.notEqual(a.state, undefined);
        assert.notEqual(a.passphrase, undefined);
    });
});
//# sourceMappingURL=syncEngine.test.js.map