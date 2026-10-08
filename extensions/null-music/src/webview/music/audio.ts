'use strict';

const audio = h('audio', { id: 'audio-player', preload: 'auto' }) as HTMLAudioElement;
let audioTrackUri: string | undefined;
let pendingSeekMs = 0;
let lastTimePost = 0;

const bannerText = h('span', { class: 'np-banner-text' });
const bannerEl = h('div', { class: 'np-banner', role: 'status', hidden: true }, bannerText, iconButton('close', 'Dismiss', () => hideBanner()));
const autoplayEl = h('button', { class: 'np-autoplay', type: 'button', hidden: true }, 'Click here to start playback');

function showBanner(text: string): void {
  bannerText.textContent = text;
  bannerEl.hidden = false;
}

function hideBanner(): void {
  bannerEl.hidden = true;
}

/** Start playback; report real failures, but not a play() that a pause() or a new load interrupted. */
function startPlayback(trackUri: string | undefined): void {
  const promise = audio.play();
  if (promise === undefined) return;
  promise.catch((err: any) => {
    if (err.name === 'AbortError') return;
    const blocked = err.name === 'NotAllowedError';
    if (blocked) autoplayEl.hidden = false;
    else showBanner('Audio play failed: ' + err.message);
    send({ type: 'localAudioPlayFailed', error: err.name + ': ' + err.message, trackUri, silent: blocked });
  });
}

function durationMsOfAudio(): number {
  return Math.round((audio.duration || 0) * 1000) || (app.player ? app.player.durationMs : 0);
}

function initAudio(): void {
  autoplayEl.addEventListener('click', () => {
    audio.play().then(() => {
      autoplayEl.hidden = true;
    }).catch((err: any) => showBanner('Play failed: ' + err.message));
  });

  audio.addEventListener('play', () => {
    hideBanner();
    autoplayEl.hidden = true;
    send({ type: 'localAudioPlayStarted' });
  });
  audio.addEventListener('pause', () => {
    send({ type: 'localAudioPaused', positionMs: Math.round(audio.currentTime * 1000), trackUri: audioTrackUri });
  });
  audio.addEventListener('timeupdate', () => {
    const cur = Math.round(audio.currentTime * 1000);
    if (!scrubDragging) updateScrubber(cur, durationMsOfAudio());
    const now = Date.now();
    if (now - lastTimePost > 1500) {
      lastTimePost = now;
      send({ type: 'localAudioTimeUpdate', positionMs: cur, trackUri: audioTrackUri });
    }
  });
  audio.addEventListener('loadedmetadata', () => {
    if (pendingSeekMs > 0) {
      audio.currentTime = pendingSeekMs / 1000;
      pendingSeekMs = 0;
    }
    send({ type: 'localAudioDuration', durationMs: Math.round(audio.duration * 1000), trackUri: audioTrackUri });
  });
  audio.addEventListener('ended', () => send({ type: 'localAudioEnded', trackUri: audioTrackUri }));
  audio.addEventListener('error', () => {
    const err = audio.error;
    let msg = 'Failed to load audio file';
    if (err) {
      if (err.code === 1) msg = 'Audio loading was aborted';
      else if (err.code === 2) msg = 'Network or filesystem error loading audio';
      else if (err.code === 3) msg = 'Audio decode error: format unsupported or file corrupted';
      else if (err.code === 4) msg = 'Audio source not supported or file inaccessible';
    }
    showBanner(msg);
    send({ type: 'localAudioError', error: msg, trackUri: audioTrackUri });
  });
}

/** Commands from WebviewAudioOutput on the host. */
function handleAudioMessage(msg: HostToWebview): void {
  switch (msg.type) {
    case 'localLoad':
      audioTrackUri = msg.trackUri;
      pendingSeekMs = msg.startMs > 0 ? msg.startMs : 0;
      hideBanner();
      if (msg.uri) {
        if (audio.src !== msg.uri) {
          audio.src = msg.uri;
        } else {
          audio.currentTime = pendingSeekMs / 1000;
          pendingSeekMs = 0;
        }
        if (msg.autoplay) startPlayback(msg.trackUri);
      }
      break;
    case 'localPause':
      audio.pause();
      break;
    case 'localResume':
      startPlayback(audioTrackUri);
      break;
    case 'localSeek':
      audio.currentTime = msg.positionMs / 1000;
      break;
    case 'localVolume':
      audio.volume = Math.max(0, Math.min(1, msg.volumePercent / 100));
      break;
  }
}

