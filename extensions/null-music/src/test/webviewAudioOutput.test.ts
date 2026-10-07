'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { AudioEvent } from '../playback/audioOutput';
import { WebviewAudioOutput } from '../playback/webviewAudioOutput';

function setup() {
  let revealed = 0;
  const out = new WebviewAudioOutput({
    revealView: async () => {
      revealed++;
    },
  });
  const posted: any[] = [];
  const view = { postMessage: (m: unknown) => posted.push(m), resolveUri: (u: string) => `webview:${u}` };
  const events: AudioEvent[] = [];
  out.onEvent((e) => events.push(e));
  return { out, view, posted, events, revealed: () => revealed };
}

test('ensureReady reveals a missing view once, then resolves on the webview ready message', async () => {
  const { out, view, events, revealed } = setup();
  const waiting = out.ensureReady(1000);
  assert.strictEqual(revealed(), 1);
  out.attach(view);
  assert.strictEqual(out.isReady, false);
  out.handleMessage({ type: 'ready' });
  await waiting;
  assert.strictEqual(out.isReady, true);
  assert.deepStrictEqual(events, [{ type: 'ready' }]);
  await out.ensureReady(1000); // already ready: immediate, no second reveal
  assert.strictEqual(revealed(), 1);
});

test('ensureReady rejects when the view never reports ready', async () => {
  const { out, view } = setup();
  out.attach(view); // present, but silent
  await assert.rejects(out.ensureReady(20));
});

test('webview messages map to audio events', () => {
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
  assert.deepStrictEqual(events, [
    { type: 'play' },
    { type: 'pause', positionMs: 900, trackUri: 'u' },
    { type: 'time', positionMs: 1500, trackUri: 'u' },
    { type: 'duration', durationMs: 5000, trackUri: 'u' },
    { type: 'ended', trackUri: 'u' },
    { type: 'error', message: 'bad', silent: false, trackUri: 'u' },
    { type: 'error', message: 'blocked', silent: true, trackUri: 'u' },
  ]);
});

test('commands post the expected webview messages and map file URIs', () => {
  const { out, view, posted } = setup();
  out.attach(view);
  out.load({ uri: 'file:///a.mp3' }, { startMs: 1200, autoplay: false });
  out.load({ uri: 'https://x.test/s.mp3' }, { startMs: 0, autoplay: true });
  out.play();
  out.pause();
  out.seek(5000);
  out.setVolume(40);
  assert.deepStrictEqual(posted, [
    { type: 'localLoad', uri: 'webview:file:///a.mp3', trackUri: 'file:///a.mp3', startMs: 1200, autoplay: false },
    { type: 'localLoad', uri: 'https://x.test/s.mp3', trackUri: 'https://x.test/s.mp3', startMs: 0, autoplay: true },
    { type: 'localResume' },
    { type: 'localPause' },
    { type: 'localSeek', positionMs: 5000 },
    { type: 'localVolume', volumePercent: 40 },
  ]);
});

test('closing the view while playing reports pause and requires a new ready', () => {
  const { out, view, events } = setup();
  out.attach(view);
  out.handleMessage({ type: 'ready' });
  events.length = 0;
  out.detach();
  assert.strictEqual(out.isReady, false);
  assert.deepStrictEqual(events, [{ type: 'pause' }]);
});
