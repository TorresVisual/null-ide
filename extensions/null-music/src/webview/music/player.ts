'use strict';

const SEEK_STEP_MS = 5000;
let scrubDragging = false;
let renderedCoverKey = '\u0000';
let scrubbedTrackId = '';
let premuteVolume = 60;

const REPEAT_LABEL = { off: 'off', context: 'all', track: 'one' };

const coverSlot = h('div', { class: 'np-cover-slot' });
const titleEl = h('div', { class: 'np-title' }, 'Nothing playing');
const likeBtn = iconButton('heart', 'Like', () => send({ type: 'toggleLike' }), 'np-like');
const artistBtn = h('button', { class: 'np-link', type: 'button' });
const sepEl = h('span', { class: 'np-sep', 'aria-hidden': 'true' }, ' · ');
const albumBtn = h('button', { class: 'np-link', type: 'button' });
const announcer = h('div', { class: 'np-sr-only', 'aria-live': 'polite' });

const timeCur = h('span', { class: 'np-time' }, '0:00');
const timeDur = h('span', { class: 'np-time' }, '0:00');
const scrubFill = h('div', { class: 'np-scrub-fill' });
const scrubHandle = h('div', { class: 'np-scrub-handle' });
const scrub = h(
  'div',
  { class: 'np-scrub', role: 'slider', tabindex: 0, 'aria-label': 'Seek', 'aria-valuemin': 0, 'aria-valuemax': 0, 'aria-valuenow': 0 },
  h('div', { class: 'np-scrub-bar' }, scrubFill, scrubHandle)
);

const shuffleBtn = iconButton('shuffle', 'Shuffle', () => send({ type: 'toggleShuffle' }));
const prevBtn = iconButton('prev', 'Previous', () => send({ type: 'previous' }));
const playBtn = iconButton('play', 'Play', () => send({ type: 'playPause' }), 'np-play');
const nextBtn = iconButton('next', 'Next', () => send({ type: 'next' }));
const repeatBtn = iconButton('repeat', 'Repeat', () => send({ type: 'toggleRepeat' }), 'np-repeat');
const muteBtn = iconButton('volume', 'Mute', () => {
  const v = app.player ? app.player.volume : 0;
  if (v > 0) premuteVolume = v;
  send({ type: 'setVolume', volumePercent: v > 0 ? 0 : premuteVolume });
});
const volumeInput = h('input', { class: 'np-volume', type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Volume' }) as HTMLInputElement;
volumeInput.addEventListener('input', () => send({ type: 'setVolume', volumePercent: Number(volumeInput.value) }));

artistBtn.addEventListener('click', () => {
  const t = app.player && app.player.track;
  if (t) openInLibrary('artist', artistKeyOf(t));
});
albumBtn.addEventListener('click', () => {
  const t = app.player && app.player.track;
  if (t) openInLibrary('album', albumKeyOf(t));
});

const playerEl = h(
  'section',
  { class: 'np-player np-loading', 'aria-label': 'Now playing' },
  coverSlot,
  h('div', { class: 'np-meta' }, h('div', { class: 'np-title-row' }, titleEl, likeBtn), h('div', { class: 'np-sub' }, artistBtn, sepEl, albumBtn)),
  h('div', { class: 'np-scrub-row' }, timeCur, scrub, timeDur),
  h('div', { class: 'np-controls' }, shuffleBtn, prevBtn, playBtn, nextBtn, repeatBtn),
  h('div', { class: 'np-volume-row' }, muteBtn, volumeInput),
  announcer
);

function currentDurationMs(): number {
  return durationMsOfAudio();
}

function updateScrubber(curMs: number, durMs: number): void {
  const pct = durMs > 0 ? Math.max(0, Math.min(100, (curMs / durMs) * 100)) : 0;
  scrubFill.style.width = pct + '%';
  scrubHandle.style.left = pct + '%';
  timeCur.textContent = formatTime(curMs);
  timeDur.textContent = formatTime(durMs);
  scrub.setAttribute('aria-valuemax', String(Math.round(durMs / 1000)));
  scrub.setAttribute('aria-valuenow', String(Math.round(curMs / 1000)));
  scrub.setAttribute('aria-valuetext', formatTime(curMs) + ' of ' + formatTime(durMs));
}

function scrubTargetMs(clientX: number): number {
  const rect = scrub.getBoundingClientRect();
  const pct = rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
  return Math.round(pct * currentDurationMs());
}

scrub.addEventListener('pointerdown', (e: PointerEvent) => {
  if (!currentDurationMs()) return;
  scrubDragging = true;
  scrub.setPointerCapture(e.pointerId);
  scrub.classList.add('dragging');
  updateScrubber(scrubTargetMs(e.clientX), currentDurationMs());
});
scrub.addEventListener('pointermove', (e: PointerEvent) => {
  if (scrubDragging) updateScrubber(scrubTargetMs(e.clientX), currentDurationMs());
});
scrub.addEventListener('pointerup', (e: PointerEvent) => {
  if (!scrubDragging) return;
  scrubDragging = false;
  scrub.classList.remove('dragging');
  send({ type: 'seek', positionMs: scrubTargetMs(e.clientX) });
});
scrub.addEventListener('pointercancel', () => {
  scrubDragging = false;
  scrub.classList.remove('dragging');
});
scrub.addEventListener('keydown', (e: KeyboardEvent) => {
  const dur = currentDurationMs();
  if (!dur) return;
  const pos = Math.round(audio.currentTime * 1000);
  let target: number | null = null;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') target = pos - SEEK_STEP_MS;
  else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') target = pos + SEEK_STEP_MS;
  else if (e.key === 'Home') target = 0;
  else if (e.key === 'End') target = dur;
  if (target === null) return;
  e.preventDefault();
  send({ type: 'seek', positionMs: Math.max(0, Math.min(dur, target)) });
});

function renderPlayer(): void {
  const s = app.player;
  if (!s) return; // keep the skeleton until the first snapshot arrives
  playerEl.classList.remove('np-loading');
  document.body.classList.toggle('np-is-playing', s.isPlaying);
  const t = s.track;

  const coverKey = t ? t.id + '|' + (t.artUrl || '') : '';
  if (coverKey !== renderedCoverKey) {
    renderedCoverKey = coverKey;
    coverSlot.replaceChildren(cover(t ? t.artUrl : undefined, t ? t.album || t.name : 'null', 'np-cover-main'));
    announcer.textContent = t ? 'Now playing: ' + t.name + (t.artist ? ' by ' + t.artist : '') : '';
  }

  titleEl.textContent = t ? t.name : 'Nothing playing';
  titleEl.title = t ? t.name : '';
  artistBtn.textContent = t ? t.artist || 'Unknown artist' : '';
  artistBtn.hidden = !t;
  albumBtn.textContent = t ? t.album : '';
  albumBtn.hidden = !t || !t.album;
  sepEl.hidden = albumBtn.hidden || artistBtn.hidden;

  likeBtn.disabled = !t;
  likeBtn.setAttribute('aria-pressed', String(s.liked));

  shuffleBtn.setAttribute('aria-pressed', String(s.shuffle));
  repeatBtn.setAttribute('aria-pressed', String(s.repeat !== 'off'));
  repeatBtn.setAttribute('data-mode', s.repeat);
  repeatBtn.setAttribute('aria-label', 'Repeat: ' + REPEAT_LABEL[s.repeat]);
  repeatBtn.title = 'Repeat: ' + REPEAT_LABEL[s.repeat];

  const nothingToPlay = !t && app.tracks.length === 0;
  playBtn.disabled = nothingToPlay;
  playBtn.title = nothingToPlay ? 'Add a music folder first' : s.isPlaying ? 'Pause' : 'Play';
  playBtn.setAttribute('aria-label', s.isPlaying ? 'Pause' : 'Play');
  playBtn.replaceChildren(icon(s.isPlaying ? 'pause' : 'play'));
  prevBtn.disabled = nextBtn.disabled = !t;

  if (document.activeElement !== volumeInput) volumeInput.value = String(s.volume);
  muteBtn.replaceChildren(icon(s.volume === 0 ? 'mute' : 'volume'));
  muteBtn.setAttribute('aria-label', s.volume === 0 ? 'Unmute' : 'Mute');
  muteBtn.title = s.volume === 0 ? 'Unmute' : 'Mute';

  // While playing, the audio element's timeupdate drives the scrubber; a snapshot only seeds it on a track change or when paused.
  const trackId = t ? t.id : '';
  if (!scrubDragging && (!s.isPlaying || scrubbedTrackId !== trackId)) updateScrubber(s.progressMs, s.durationMs);
  scrubbedTrackId = trackId;
}
