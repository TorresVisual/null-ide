'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const webviewAudioOutput_1 = require("../playback/webviewAudioOutput");
function setup() {
    let revealed = 0;
    const out = new webviewAudioOutput_1.WebviewAudioOutput({
        revealView: async () => {
            revealed++;
        },
    });
    const posted = [];
    const view = { postMessage: (m) => posted.push(m), resolveUri: (u) => `webview:${u}` };
    const events = [];
    out.onEvent((e) => events.push(e));
    return { out, view, posted, events, revealed: () => revealed };
}
(0, node_test_1.test)('ensureReady reveals a missing view once, then resolves on the webview ready message', async () => {
    const { out, view, events, revealed } = setup();
    const waiting = out.ensureReady(1000);
    node_assert_1.default.strictEqual(revealed(), 1);
    out.attach(view);
    node_assert_1.default.strictEqual(out.isReady, false);
    out.handleMessage({ type: 'ready' });
    await waiting;
    node_assert_1.default.strictEqual(out.isReady, true);
    node_assert_1.default.deepStrictEqual(events, [{ type: 'ready' }]);
    await out.ensureReady(1000); // already ready: immediate, no second reveal
    node_assert_1.default.strictEqual(revealed(), 1);
});
(0, node_test_1.test)('ensureReady rejects when the view never reports ready', async () => {
    const { out, view } = setup();
    out.attach(view); // present, but silent
    await node_assert_1.default.rejects(out.ensureReady(20));
});
(0, node_test_1.test)('webview messages map to audio events', () => {
    const { out, events } = setup();
    out.handleMessage({ type: 'localAudioPlayStarted' });
    out.handleMessage({ type: 'localAudioPaused', positionMs: 900, trackUri: 'u' });
    out.handleMessage({ type: 'localAudioTimeUpdate', positionMs: 1500, trackUri: 'u' });
    out.handleMessage({ type: 'localAudioDuration', durationMs: 5000, trackUri: 'u' });
    out.handleMessage({ type: 'localAudioEnded', trackUri: 'u' });
    out.handleMessage({ type: 'localAudioError', error: 'bad', trackUri: 'u' });
    out.handleMessage({ type: 'localAudioPlayFailed', error: 'blocked', trackUri: 'u', silent: true });
    out.handleMessage({ type: 'localAudioTimeUpdate', positionMs: 'x' }); // malformed: ignored
    out.handleMessage(undefined);
    node_assert_1.default.deepStrictEqual(events, [
        { type: 'play' },
        { type: 'pause', positionMs: 900, trackUri: 'u' },
        { type: 'time', positionMs: 1500, trackUri: 'u' },
        { type: 'duration', durationMs: 5000, trackUri: 'u' },
        { type: 'ended', trackUri: 'u' },
        { type: 'error', message: 'bad', silent: false, trackUri: 'u' },
        { type: 'error', message: 'blocked', silent: true, trackUri: 'u' },
    ]);
});
(0, node_test_1.test)('commands post the expected webview messages and map file URIs', () => {
    const { out, view, posted } = setup();
    out.attach(view);
    out.load({ uri: 'file:///a.mp3' }, { startMs: 1200, autoplay: false });
    out.load({ uri: 'https://x.test/s.mp3' }, { startMs: 0, autoplay: true });
    out.play();
    out.pause();
    out.seek(5000);
    out.setVolume(40);
    node_assert_1.default.deepStrictEqual(posted, [
        { type: 'localLoad', uri: 'webview:file:///a.mp3', trackUri: 'file:///a.mp3', startMs: 1200, autoplay: false },
        { type: 'localLoad', uri: 'https://x.test/s.mp3', trackUri: 'https://x.test/s.mp3', startMs: 0, autoplay: true },
        { type: 'localResume' },
        { type: 'localPause' },
        { type: 'localSeek', positionMs: 5000 },
        { type: 'localVolume', volumePercent: 40 },
    ]);
});
(0, node_test_1.test)('closing the view while playing reports pause and requires a new ready', () => {
    const { out, view, events } = setup();
    out.attach(view);
    out.handleMessage({ type: 'ready' });
    events.length = 0;
    out.detach();
    node_assert_1.default.strictEqual(out.isReady, false);
    node_assert_1.default.deepStrictEqual(events, [{ type: 'pause' }]);
});
//# sourceMappingURL=webviewAudioOutput.test.js.map