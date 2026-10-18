import assert from 'node:assert';
import test from 'node:test';
import { formatBytes, canSelfUpdate, hasPlatformPackage, isSafeTag, isStillAvailable, parseProgressLine, releasePageStatus, shouldAcknowledge, statusFor } from './updateStatus';

test('parseProgressLine reads the lines null-setup prints', () => {
  assert.deepStrictEqual(parseProgressLine('{"state":"checking"}'), { state: 'checking' });
  assert.deepStrictEqual(
    parseProgressLine('{"state":"downloading","bytes":50,"total":200,"bytesPerSec":10}'),
    { state: 'downloading', bytes: 50, total: 200, bytesPerSec: 10 },
  );
  assert.deepStrictEqual(
    parseProgressLine('{"state":"failed","message":"HTTP 404 from x","log":null}'),
    { state: 'failed', message: 'HTTP 404 from x', log: undefined },
  );
  assert.deepStrictEqual(parseProgressLine('{"state":"ready"}'), { state: 'ready' });
});

test('parseProgressLine ignores noise and unknown states', () => {
  assert.strictEqual(parseProgressLine('not json'), undefined);
  assert.strictEqual(parseProgressLine('null'), undefined);
  assert.strictEqual(parseProgressLine('{"state":"mystery"}'), undefined);
  assert.strictEqual(parseProgressLine('{"state":"downloading"}'), undefined);
});

test('statusFor maps every state to a status item', () => {
  assert.match(statusFor('v2', undefined, true).text, /Restart to update/);
  assert.match(statusFor('v2', { state: 'downloading', bytes: 50, total: 200, bytesPerSec: 1048576 }, false).text, /v2 25%/);
  assert.match(statusFor('v2', { state: 'downloading', bytes: 50, total: 0, bytesPerSec: 0 }, false).text, /v2 0%/);
  assert.match(statusFor('v2', { state: 'verifying' }, false).text, /Verifying/);
  const failed = statusFor('v2', { state: 'failed', message: 'boom', log: 'C:\\l.log' }, false);
  assert.match(failed.text, /failed/);
  assert.match(failed.tooltip, /boom/);
  assert.match(failed.tooltip, /C:\\l\.log/);
  assert.match(statusFor('v2', undefined, false).text, /v2/);
});

test('ready wins over a stale progress state', () => {
  assert.match(statusFor('v2', { state: 'downloading', bytes: 1, total: 2, bytesPerSec: 0 }, true).text, /Restart to update/);
});

test('formatBytes uses KB below 1 MB and MB above', () => {
  assert.strictEqual(formatBytes(512), '0.5 KB');
  assert.strictEqual(formatBytes(1048576), '1.0 MB');
  assert.strictEqual(formatBytes(83886080), '80.0 MB');
});

test('isSafeTag only allows characters that are safe in a directory name', () => {
  assert.ok(isSafeTag('v1.2.3'));
  assert.ok(isSafeTag('nightly-2026-10-14_1'));
  assert.ok(!isSafeTag(''));
  assert.ok(!isSafeTag('..\\evil'));
  assert.ok(!isSafeTag('a/b'));
  assert.ok(!isSafeTag('v1..2'));
});

test('shouldAcknowledge only fires once the new install is in place', () => {
  assert.ok(shouldAcknowledge('{"plan":{},"step":"MovedIn"}'));
  assert.ok(!shouldAcknowledge('{"plan":{},"step":"Started"}'));
  assert.ok(!shouldAcknowledge('{"plan":{},"step":"AsideDone"}'));
  assert.ok(!shouldAcknowledge(undefined));
  assert.ok(!shouldAcknowledge('garbage'));
  assert.ok(!shouldAcknowledge('null'));
});

test('a remembered update is dropped once the running version has caught up', () => {
  assert.ok(isStillAvailable('v1.0.18', 'v1.0.17'));
  assert.ok(!isStillAvailable('v1.0.18', 'v1.0.18'));
  assert.ok(!isStillAvailable('v1.0.18', 'v1.1.0'));
  assert.ok(isStillAvailable('v1.0.18', 'local'));
});

const assets = (...names: string[]) => names.map(name => ({ name }));

test('hasPlatformPackage picks each platform\'s own package, never a sidecar or the deb', () => {
  const release = assets(
    'null-ide-win32-x64-v2.zip', 'null-ide-win32-x64-v2.zip.sha256',
    'null-ide-linux-x64-v2.tar.gz', 'null-ide-linux-x64-v2.tar.gz.sha256', 'null-ide-linux-x64-v2.deb',
  );
  assert.strictEqual(hasPlatformPackage('win32', release), true);
  assert.strictEqual(hasPlatformPackage('linux', release), true);
  assert.strictEqual(hasPlatformPackage('win32', assets('null-ide-win32-x64.zip')), true);
  assert.strictEqual(hasPlatformPackage('win32', assets('null-ide-win32-x64-v2.zip.sha256', 'null-ide-linux-x64-v2.tar.gz')), false);
  assert.strictEqual(hasPlatformPackage('linux', assets('null-ide-linux-x64-v2.tar.gz.sha256', 'null-ide-linux-x64-v2.deb', 'null-ide-win32-x64-v2.zip')), false);
});

test('hasPlatformPackage is false for unknown platforms and missing asset lists', () => {
  assert.strictEqual(hasPlatformPackage('darwin', assets('null-ide-win32-x64-v2.zip')), false);
  assert.strictEqual(hasPlatformPackage('linux', undefined), false);
});

test('only Windows installs can replace themselves', () => {
  assert.strictEqual(canSelfUpdate('win32'), true);
  assert.strictEqual(canSelfUpdate('linux'), false);
});

test('the Linux status button points at the release page', () => {
  const view = releasePageStatus('v2');
  assert.match(view.text, /v2/);
  assert.match(view.tooltip, /release page/);
});
