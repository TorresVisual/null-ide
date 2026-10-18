"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const updateStatus_1 = require("./updateStatus");
(0, node_test_1.default)('parseProgressLine reads the lines null-setup prints', () => {
    node_assert_1.default.deepStrictEqual((0, updateStatus_1.parseProgressLine)('{"state":"checking"}'), { state: 'checking' });
    node_assert_1.default.deepStrictEqual((0, updateStatus_1.parseProgressLine)('{"state":"downloading","bytes":50,"total":200,"bytesPerSec":10}'), { state: 'downloading', bytes: 50, total: 200, bytesPerSec: 10 });
    node_assert_1.default.deepStrictEqual((0, updateStatus_1.parseProgressLine)('{"state":"failed","message":"HTTP 404 from x","log":null}'), { state: 'failed', message: 'HTTP 404 from x', log: undefined });
    node_assert_1.default.deepStrictEqual((0, updateStatus_1.parseProgressLine)('{"state":"ready"}'), { state: 'ready' });
});
(0, node_test_1.default)('parseProgressLine ignores noise and unknown states', () => {
    node_assert_1.default.strictEqual((0, updateStatus_1.parseProgressLine)('not json'), undefined);
    node_assert_1.default.strictEqual((0, updateStatus_1.parseProgressLine)('null'), undefined);
    node_assert_1.default.strictEqual((0, updateStatus_1.parseProgressLine)('{"state":"mystery"}'), undefined);
    node_assert_1.default.strictEqual((0, updateStatus_1.parseProgressLine)('{"state":"downloading"}'), undefined);
});
(0, node_test_1.default)('statusFor maps every state to a status item', () => {
    node_assert_1.default.match((0, updateStatus_1.statusFor)('v2', undefined, true).text, /Restart to update/);
    node_assert_1.default.match((0, updateStatus_1.statusFor)('v2', { state: 'downloading', bytes: 50, total: 200, bytesPerSec: 1048576 }, false).text, /v2 25%/);
    node_assert_1.default.match((0, updateStatus_1.statusFor)('v2', { state: 'downloading', bytes: 50, total: 0, bytesPerSec: 0 }, false).text, /v2 0%/);
    node_assert_1.default.match((0, updateStatus_1.statusFor)('v2', { state: 'verifying' }, false).text, /Verifying/);
    const failed = (0, updateStatus_1.statusFor)('v2', { state: 'failed', message: 'boom', log: 'C:\\l.log' }, false);
    node_assert_1.default.match(failed.text, /failed/);
    node_assert_1.default.match(failed.tooltip, /boom/);
    node_assert_1.default.match(failed.tooltip, /C:\\l\.log/);
    node_assert_1.default.match((0, updateStatus_1.statusFor)('v2', undefined, false).text, /v2/);
});
(0, node_test_1.default)('ready wins over a stale progress state', () => {
    node_assert_1.default.match((0, updateStatus_1.statusFor)('v2', { state: 'downloading', bytes: 1, total: 2, bytesPerSec: 0 }, true).text, /Restart to update/);
});
(0, node_test_1.default)('formatBytes uses KB below 1 MB and MB above', () => {
    node_assert_1.default.strictEqual((0, updateStatus_1.formatBytes)(512), '0.5 KB');
    node_assert_1.default.strictEqual((0, updateStatus_1.formatBytes)(1048576), '1.0 MB');
    node_assert_1.default.strictEqual((0, updateStatus_1.formatBytes)(83886080), '80.0 MB');
});
(0, node_test_1.default)('isSafeTag only allows characters that are safe in a directory name', () => {
    node_assert_1.default.ok((0, updateStatus_1.isSafeTag)('v1.2.3'));
    node_assert_1.default.ok((0, updateStatus_1.isSafeTag)('nightly-2026-10-14_1'));
    node_assert_1.default.ok(!(0, updateStatus_1.isSafeTag)(''));
    node_assert_1.default.ok(!(0, updateStatus_1.isSafeTag)('..\\evil'));
    node_assert_1.default.ok(!(0, updateStatus_1.isSafeTag)('a/b'));
    node_assert_1.default.ok(!(0, updateStatus_1.isSafeTag)('v1..2'));
});
(0, node_test_1.default)('shouldAcknowledge only fires once the new install is in place', () => {
    node_assert_1.default.ok((0, updateStatus_1.shouldAcknowledge)('{"plan":{},"step":"MovedIn"}'));
    node_assert_1.default.ok(!(0, updateStatus_1.shouldAcknowledge)('{"plan":{},"step":"Started"}'));
    node_assert_1.default.ok(!(0, updateStatus_1.shouldAcknowledge)('{"plan":{},"step":"AsideDone"}'));
    node_assert_1.default.ok(!(0, updateStatus_1.shouldAcknowledge)(undefined));
    node_assert_1.default.ok(!(0, updateStatus_1.shouldAcknowledge)('garbage'));
    node_assert_1.default.ok(!(0, updateStatus_1.shouldAcknowledge)('null'));
});
(0, node_test_1.default)('a remembered update is dropped once the running version has caught up', () => {
    node_assert_1.default.ok((0, updateStatus_1.isStillAvailable)('v1.0.18', 'v1.0.17'));
    node_assert_1.default.ok(!(0, updateStatus_1.isStillAvailable)('v1.0.18', 'v1.0.18'));
    node_assert_1.default.ok(!(0, updateStatus_1.isStillAvailable)('v1.0.18', 'v1.1.0'));
    node_assert_1.default.ok((0, updateStatus_1.isStillAvailable)('v1.0.18', 'local'));
});
const assets = (...names) => names.map(name => ({ name }));
(0, node_test_1.default)('hasPlatformPackage picks each platform\'s own package, never a sidecar or the deb', () => {
    const release = assets('null-ide-win32-x64-v2.zip', 'null-ide-win32-x64-v2.zip.sha256', 'null-ide-linux-x64-v2.tar.gz', 'null-ide-linux-x64-v2.tar.gz.sha256', 'null-ide-linux-x64-v2.deb');
    node_assert_1.default.strictEqual((0, updateStatus_1.hasPlatformPackage)('win32', release), true);
    node_assert_1.default.strictEqual((0, updateStatus_1.hasPlatformPackage)('linux', release), true);
    node_assert_1.default.strictEqual((0, updateStatus_1.hasPlatformPackage)('win32', assets('null-ide-win32-x64.zip')), true);
    node_assert_1.default.strictEqual((0, updateStatus_1.hasPlatformPackage)('win32', assets('null-ide-win32-x64-v2.zip.sha256', 'null-ide-linux-x64-v2.tar.gz')), false);
    node_assert_1.default.strictEqual((0, updateStatus_1.hasPlatformPackage)('linux', assets('null-ide-linux-x64-v2.tar.gz.sha256', 'null-ide-linux-x64-v2.deb', 'null-ide-win32-x64-v2.zip')), false);
});
(0, node_test_1.default)('hasPlatformPackage is false for unknown platforms and missing asset lists', () => {
    node_assert_1.default.strictEqual((0, updateStatus_1.hasPlatformPackage)('darwin', assets('null-ide-win32-x64-v2.zip')), false);
    node_assert_1.default.strictEqual((0, updateStatus_1.hasPlatformPackage)('linux', undefined), false);
});
(0, node_test_1.default)('only Windows installs can replace themselves', () => {
    node_assert_1.default.strictEqual((0, updateStatus_1.canSelfUpdate)('win32'), true);
    node_assert_1.default.strictEqual((0, updateStatus_1.canSelfUpdate)('linux'), false);
});
(0, node_test_1.default)('the Linux status button points at the release page', () => {
    const view = (0, updateStatus_1.releasePageStatus)('v2');
    node_assert_1.default.match(view.text, /v2/);
    node_assert_1.default.match(view.tooltip, /release page/);
});
//# sourceMappingURL=updateStatus.test.js.map