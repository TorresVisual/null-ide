'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const projectBinding_1 = require("./projectBinding");
const testFakes_1 = require("./testFakes");
function makeBinding() {
    const meta = new testFakes_1.FakeMeta();
    return { meta, binding: new projectBinding_1.ProjectBinding(meta, 'win32') };
}
(0, node_test_1.test)('folderKey folds case, slashes and trailing separators on Windows', () => {
    node_assert_1.default.strictEqual((0, projectBinding_1.folderKey)('C:\\Repo\\', 'win32'), 'c:/repo');
    node_assert_1.default.strictEqual((0, projectBinding_1.folderKey)('c:/repo', 'win32'), 'c:/repo');
    node_assert_1.default.strictEqual((0, projectBinding_1.folderKey)('C:\\Users\\Me\\My Project', 'win32'), 'c:/users/me/my project');
});
(0, node_test_1.test)('folderKey keeps case elsewhere and drops a trailing slash', () => {
    node_assert_1.default.strictEqual((0, projectBinding_1.folderKey)('/home/Me/Repo/', 'linux'), '/home/Me/Repo');
    node_assert_1.default.notStrictEqual((0, projectBinding_1.folderKey)('/home/me/repo', 'linux'), (0, projectBinding_1.folderKey)('/home/Me/Repo', 'linux'));
});
(0, node_test_1.test)('a binding is found however the folder path is written', async () => {
    const { binding } = makeBinding();
    await binding.bind('C:\\Repo', 'a1');
    node_assert_1.default.strictEqual(binding.accountIdFor('c:/repo/'), 'a1');
    node_assert_1.default.strictEqual(binding.accountIdFor('C:\\Other'), undefined);
});
(0, node_test_1.test)('rebind replaces, unbind removes, and only real changes fire an event', async () => {
    const { binding } = makeBinding();
    let fired = 0;
    binding.onDidChange(() => fired++);
    await binding.bind('C:\\Repo', 'a1');
    await binding.bind('c:/repo', 'a1'); // same folder, same account: no change
    node_assert_1.default.strictEqual(fired, 1);
    await binding.bind('C:\\Repo', 'a2');
    node_assert_1.default.strictEqual(binding.accountIdFor('C:\\Repo'), 'a2');
    node_assert_1.default.strictEqual(fired, 2);
    await binding.unbind('C:\\Repo');
    node_assert_1.default.strictEqual(binding.accountIdFor('C:\\Repo'), undefined);
    node_assert_1.default.strictEqual(fired, 3);
    await binding.unbind('C:\\Repo'); // already gone
    node_assert_1.default.strictEqual(fired, 3);
});
(0, node_test_1.test)('prune drops bindings to accounts that no longer exist', async () => {
    const { binding } = makeBinding();
    await binding.bind('C:\\a', 'a1');
    await binding.bind('C:\\b', 'a2');
    let fired = 0;
    binding.onDidChange(() => fired++);
    await binding.prune(new Set(['a1', 'a2']));
    node_assert_1.default.strictEqual(fired, 0);
    await binding.prune(new Set(['a1']));
    node_assert_1.default.strictEqual(binding.accountIdFor('C:\\a'), 'a1');
    node_assert_1.default.strictEqual(binding.accountIdFor('C:\\b'), undefined);
    node_assert_1.default.strictEqual(fired, 1);
});
(0, node_test_1.test)('corrupt stored data reads as no bindings and is overwritten by the next bind', async () => {
    const { binding, meta } = makeBinding();
    meta.data.set(projectBinding_1.BINDINGS_KEY, 'garbage');
    node_assert_1.default.strictEqual(binding.accountIdFor('C:\\a'), undefined);
    meta.data.set(projectBinding_1.BINDINGS_KEY, { 'c:/bad': 5, 'c:/ok': 'a1' });
    node_assert_1.default.strictEqual(binding.accountIdFor('C:\\ok'), 'a1');
    node_assert_1.default.strictEqual(binding.accountIdFor('C:\\bad'), undefined);
    meta.data.set(projectBinding_1.BINDINGS_KEY, ['not', 'a', 'map']);
    await binding.bind('C:\\a', 'a1');
    node_assert_1.default.strictEqual(binding.accountIdFor('C:\\a'), 'a1');
});
(0, node_test_1.test)('entries lists every binding as [folder key, account id]', async () => {
    const b = new projectBinding_1.ProjectBinding(new testFakes_1.FakeMeta(), 'linux');
    node_assert_1.default.deepStrictEqual(b.entries(), []);
    await b.bind('/work/a', 'acc1');
    await b.bind('/work/b', 'acc2');
    node_assert_1.default.deepStrictEqual(b.entries(), [['/work/a', 'acc1'], ['/work/b', 'acc2']]);
});
(0, node_test_1.test)('a folder key from entries() can be passed straight back to unbind, on Windows too', async () => {
    const b = new projectBinding_1.ProjectBinding(new testFakes_1.FakeMeta(), 'win32');
    await b.bind('C:\\Work\\MyRepo\\', 'acc1');
    const [[key]] = b.entries();
    node_assert_1.default.strictEqual(key, 'c:/work/myrepo'); // lower-cased: Windows paths are case-insensitive
    await b.unbind(key);
    node_assert_1.default.deepStrictEqual(b.entries(), []);
});
//# sourceMappingURL=projectBinding.test.js.map