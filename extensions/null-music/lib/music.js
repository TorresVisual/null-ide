'use strict';
/**
 * Builds an element from text nodes and setAttribute only, so data (track names, paths) is never
 * parsed as HTML. `true` sets a boolean attribute; null/undefined/false attributes and children are skipped.
 * Never pass `style`: the CSP forbids inline style attributes (use el.style.setProperty).
 */
function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
        for (const name of Object.keys(attrs)) {
            const v = attrs[name];
            if (v === null || v === undefined || v === false)
                continue;
            el.setAttribute(name, v === true ? '' : String(v));
        }
    }
    for (const c of children) {
        if (c === null || c === undefined || c === false)
            continue;
        el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
}
/** `text` as strings and <mark> elements around every case-insensitive occurrence of `query`. */
function markText(text, query) {
    const out = [];
    let at = 0;
    for (const range of highlightRanges(text, query)) {
        if (range[0] > at)
            out.push(text.slice(at, range[0]));
        out.push(h('mark', null, text.slice(range[0], range[1])));
        at = range[1];
    }
    if (at < text.length || out.length === 0)
        out.push(text.slice(at));
    return out;
}
/** Value for `data-vscode-context`: makes the `webview/context` menu contribution fire for this track. */
function trackContext(trackId) {
    return JSON.stringify({ webviewSection: 'track', trackId, preventDefaultContextMenuItems: true });
}
const UNKNOWN_ARTIST = 'Unknown artist';
const UNKNOWN_ALBUM = 'Unknown album';
const SEPARATOR = /[\s\-_.,/()\[\]]/;
function formatTime(ms) {
    if (!(ms > 0))
        return '0:00';
    const total = Math.floor(ms / 1000);
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const ss = secs < 10 ? '0' + secs : String(secs);
    if (hrs > 0)
        return hrs + ':' + (mins < 10 ? '0' + mins : String(mins)) + ':' + ss;
    return mins + ':' + ss;
}
function compareText(a, b) {
    return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}
function artistOf(t) {
    return (t.albumArtist || t.artist || '').trim() || UNKNOWN_ARTIST;
}
/** Stable ids the player's artist/album links and the Library detail views use. */
function artistKeyOf(t) {
    return artistOf(t).toLowerCase();
}
function albumKeyOf(t) {
    return artistKeyOf(t) + '\u0000' + (t.album.trim() || UNKNOWN_ALBUM).toLowerCase();
}
/** Disc, then track number (untagged last), then title. */
function albumOrder(a, b) {
    const na = a.trackNo === undefined ? 1e9 : a.trackNo;
    const nb = b.trackNo === undefined ? 1e9 : b.trackNo;
    return (a.discNo || 1) - (b.discNo || 1) || na - nb || compareText(a.name, b.name);
}
function sortTracks(tracks, key) {
    const by = {
        title: (a, b) => compareText(a.name, b.name),
        artist: (a, b) => compareText(a.artist, b.artist) || compareText(a.name, b.name),
        album: (a, b) => compareText(a.album, b.album) || albumOrder(a, b),
        duration: (a, b) => a.durationMs - b.durationMs || compareText(a.name, b.name),
    };
    return tracks.slice().sort(by[key]);
}
function groupAlbums(tracks) {
    const map = new Map();
    for (const t of tracks) {
        const artist = artistOf(t);
        const name = t.album.trim() || UNKNOWN_ALBUM;
        const key = albumKeyOf(t);
        let album = map.get(key);
        if (!album) {
            album = { key, name, artist, tracks: [] };
            map.set(key, album);
        }
        album.tracks.push(t);
        if (album.year === undefined && t.year)
            album.year = t.year;
        if (!album.artUrl && t.artUrl)
            album.artUrl = t.artUrl;
    }
    const out = Array.from(map.values());
    for (const a of out)
        a.tracks.sort(albumOrder);
    return out.sort((a, b) => compareText(a.name, b.name) || compareText(a.artist, b.artist));
}
function groupArtists(tracks) {
    const map = new Map();
    for (const t of tracks) {
        const key = artistKeyOf(t);
        const entry = map.get(key);
        if (entry)
            entry.tracks.push(t);
        else
            map.set(key, { name: artistOf(t), tracks: [t] });
    }
    const out = [];
    map.forEach((entry, key) => {
        const albums = groupAlbums(entry.tracks);
        const ordered = [];
        let artUrl;
        for (const a of albums) {
            for (const t of a.tracks)
                ordered.push(t);
            if (!artUrl && a.artUrl)
                artUrl = a.artUrl;
        }
        out.push({ key, name: entry.name, artUrl, albums, tracks: ordered });
    });
    return out.sort((a, b) => compareText(a.name, b.name));
}
/** 3 = prefix, 2 = starts a word, 1 = elsewhere, 0 = no match. Plain indexOf: the query is never a pattern. */
function scoreText(text, query) {
    const q = query.trim().toLowerCase();
    if (!q)
        return 0;
    const t = text.toLowerCase();
    let best = 0;
    let from = 0;
    for (;;) {
        const at = t.indexOf(q, from);
        if (at < 0)
            return best;
        if (at === 0)
            return 3;
        if (SEPARATOR.test(t.charAt(at - 1)))
            best = 2;
        else if (best === 0)
            best = 1;
        from = at + 1;
    }
}
/** Keeps matching items, best first (ties keep list order). The first field outranks the others. */
function rankItems(items, query, fields) {
    if (!query.trim())
        return items;
    const scored = [];
    items.forEach((item, i) => {
        const f = fields(item);
        let rest = 0;
        for (let k = 1; k < f.length; k++)
            rest = Math.max(rest, scoreText(f[k], query));
        const score = scoreText(f[0], query) * 10 + rest;
        if (score > 0)
            scored.push({ item, score, i });
    });
    scored.sort((a, b) => b.score - a.score || a.i - b.i);
    return scored.map((s) => s.item);
}
function rankTracks(tracks, query) {
    return rankItems(tracks, query, (t) => [t.name, t.artist, t.album]);
}
/** For views that must keep their order (queue, album detail): does the track match at all? Blank query matches everything. */
function matchesTrack(t, query) {
    return !query.trim() || scoreText(t.name, query) + scoreText(t.artist, query) + scoreText(t.album, query) > 0;
}
function highlightRanges(text, query) {
    const q = query.trim().toLowerCase();
    const out = [];
    if (!q)
        return out;
    const t = text.toLowerCase();
    let from = 0;
    for (;;) {
        const at = t.indexOf(q, from);
        if (at < 0)
            return out;
        out.push([at, at + q.length]);
        from = at + q.length;
    }
}
function placeholderHue(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++)
        hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return hash % 360;
}
function resolveTracks(ids, byId) {
    const out = [];
    for (const id of ids) {
        const t = byId.get(id);
        if (t)
            out.push(t);
    }
    return out;
}
/** The `beforeKey` for moving `key` one slot up/down among `keys`; undefined when it cannot move. */
function reorderTarget(keys, key, dir) {
    const at = keys.indexOf(key);
    if (at < 0)
        return undefined;
    if (dir === -1)
        return at === 0 ? undefined : keys[at - 1];
    if (at === keys.length - 1)
        return undefined;
    return at + 2 < keys.length ? keys[at + 2] : null;
}
// Hand-drawn 16px stroke icons (codicon style). Check them at 100% zoom in Step 12 and nudge a path if one looks off.
const ICON_PATHS = {
    play: '<path d="M4 2.5v11l9-5.5z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor" stroke="none"/>',
    next: '<path d="M3 2.5v11l8-5.5zM12 2.5h1.5v11H12z" fill="currentColor" stroke="none"/>',
    prev: '<path d="M13 2.5v11L5 8zM2.5 2.5H4v11H2.5z" fill="currentColor" stroke="none"/>',
    shuffle: '<path d="M1.5 4.5h2.5c3 0 4 7 7 7h3M1.5 11.5h2.5c1 0 1.8-.8 2.5-1.8M8.5 6c.7-.9 1.5-1.5 2.5-1.5h3M12.5 2.5l2 2-2 2M12.5 9.5l2 2-2 2"/>',
    repeat: '<path d="M3 7V6a2 2 0 0 1 2-2h8M11 1.5l2 2.5-2 2.5M13 9v1a2 2 0 0 1-2 2H3M5 14.5 3 12l2-2.5"/>',
    heart: '<path d="M8 13.5 2.7 8.2a3.1 3.1 0 0 1 4.4-4.4L8 4.7l.9-.9a3.1 3.1 0 0 1 4.4 4.4z"/>',
    volume: '<path d="M2 6v4h2.5L8 13V3L4.5 6zM10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6.5 6.5 0 0 1 0 9"/>',
    mute: '<path d="M2 6v4h2.5L8 13V3L4.5 6zM10.5 6l4 4M14.5 6l-4 4"/>',
    search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 4 4"/>',
    more: '<circle cx="3" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="13" cy="8" r="1" fill="currentColor"/>',
    back: '<path d="M10 2.5 4.5 8 10 13.5"/>',
    close: '<path d="m3.5 3.5 9 9M12.5 3.5l-9 9"/>',
    warning: '<path d="M8 2 14.5 13.5h-13zM8 6.5v3.5M8 11.8v.4"/>',
    folder: '<path d="M1.5 3.5h4l1.5 1.5h7.5v7.5h-13z"/>',
    list: '<path d="M2 4h12M2 8h12M2 12h8"/>',
    note: '<path d="M6 12.5V3l7-1.5V11M8 12.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM15 11a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/>',
    plus: '<path d="M8 3v10M3 8h10"/>',
    disc: '<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="1.5"/>',
    user: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c.5-3 2.5-4 5-4s4.5 1 5 4"/>',
};
function icon(name) {
    const span = h('span', { class: 'np-icon', 'aria-hidden': 'true' });
    // The one place markup is parsed: a static constant from the table above, never data.
    span.innerHTML =
        '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" ' +
            'stroke-linecap="round" stroke-linejoin="round" focusable="false">' + (ICON_PATHS[name] || '') + '</svg>';
    return span;
}
function iconButton(name, label, onClick, extraClass) {
    const b = h('button', { class: 'np-btn' + (extraClass ? ' ' + extraClass : ''), type: 'button', 'aria-label': label, title: label }, icon(name));
    b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return b;
}
const vscodeApi = acquireVsCodeApi(); // may be called only once per webview
/** The only way the webview talks to the host; the union makes a renamed message a compile error. */
function send(msg) {
    vscodeApi.postMessage(msg);
}
/** The webview's copy of the host snapshots, plus UI-only state. Views read this and never mutate the snapshot half. */
const app = {
    player: null,
    unavailable: new Set(),
    unavailableKey: '',
    queue: { history: [], current: null, upcoming: [], reorderable: true },
    tracks: [],
    byId: new Map(),
    folders: [],
    playlists: [],
    scan: { scanned: 0, total: 0 },
    extensions: [],
    liked: new Set(),
    libraryLoaded: false,
    // UI-only
    tab: 'queue',
    segment: 'tracks',
    likedOnly: false,
    sort: 'title',
    query: '',
    libraryDetail: null,
    playlistId: null,
    showFolders: false,
    historyOpen: false,
    /** Scroll offset saved when a detail view opens, and whether the next render of the list should go back to it. */
    detailScroll: 0,
    restoreScroll: false,
};
/** Each tab's view registers itself here (at the bottom of its file); main.ts calls the active one. */
const tabRenderers = {};
const dirty = { player: false, header: false, content: false };
let flushQueued = false;
/** Coalesces renders into one animation frame (frames are also skipped while the view is hidden). */
function invalidate(part) {
    dirty[part] = true;
    if (flushQueued)
        return;
    flushQueued = true;
    requestAnimationFrame(() => {
        flushQueued = false;
        if (dirty.player) {
            dirty.player = false;
            renderPlayer();
        }
        if (dirty.header) {
            dirty.header = false;
            renderHeader();
        }
        if (dirty.content) {
            dirty.content = false;
            renderContent();
        }
    });
}
function setQuery(query) {
    app.query = query;
    invalidate('header'); // keeps the search box in sync when a view clears the query
    invalidate('content');
}
/** Jump from the player's artist/album text into the Library detail view. */
function openInLibrary(kind, id) {
    app.query = '';
    app.libraryDetail = { kind, id };
    app.segment = kind === 'album' ? 'albums' : 'artists';
    app.showFolders = false;
    setTab('library');
}
/** Square cover, or the ∅ placeholder tinted from `seed` when there is no art (or it fails to load). */
function cover(artUrl, seed, cls) {
    const box = h('div', { class: 'np-cover ' + cls });
    const placeholder = () => {
        box.classList.add('np-cover-ph');
        box.style.setProperty('--hue', String(placeholderHue(seed)));
        box.replaceChildren(h('span', { class: 'np-ph-mark', 'aria-hidden': 'true' }, '∅'));
    };
    if (artUrl) {
        const img = h('img', { src: artUrl, alt: '', loading: 'lazy', draggable: 'false' });
        img.addEventListener('error', placeholder);
        box.appendChild(img);
    }
    else {
        placeholder();
    }
    return box;
}
function likeButton(trackId) {
    return iconButton('heart', 'Like', () => send({ type: 'toggleLike', trackId }), 'np-like');
}
function trackRow(t, o) {
    const q = o.query || '';
    const row = h('div', {
        class: 'np-row',
        role: 'option',
        tabindex: -1,
        'data-row': true,
        'data-track-id': t.id,
        'data-key': o.key === undefined ? null : o.key,
        'data-vscode-context': trackContext(t.id),
    }, h('div', { class: 'np-thumb-wrap' }, cover(t.artUrl, t.album || t.name, 'np-thumb'), h('span', { class: 'np-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))), h('div', { class: 'np-row-text' }, h('div', { class: 'np-row-title' }, ...markText(t.name, q)), h('div', { class: 'np-row-sub' }, ...markText(t.artist || 'Unknown artist', q))), h('span', { class: 'np-warn', title: 'This file could not be played' }, icon('warning')), h('span', { class: 'np-row-time' }, formatTime(t.durationMs)), likeButton(t.id), ...(o.extra || []));
    row.addEventListener('click', (e) => {
        if (e.target.closest('button'))
            return;
        o.onPlay();
    });
    return row;
}
function emptyState(iconName, title, body, actions = []) {
    return h('div', { class: 'np-empty' }, icon(iconName), h('div', { class: 'np-empty-title' }, title), body ? h('div', { class: 'np-empty-body' }, body) : null, actions.length ? h('div', { class: 'np-empty-actions' }, ...actions) : null);
}
/** True until the user has added a folder or playlist (and the first library snapshot has arrived). */
function hasNoSources() {
    return app.libraryLoaded && app.folders.length === 0 && app.playlists.length === 0;
}
function noLibraryState() {
    return emptyState('note', 'Add a music folder', 'Null Music plays audio files from folders on this computer, and .m3u8 playlists.', [
        textButton('Add folder', () => send({ type: 'addFolder' }), true),
        textButton('Import playlist', () => send({ type: 'importPlaylist' })),
    ]);
}
function noResultsState() {
    return emptyState('search', 'No matches', 'Nothing here matches "' + app.query.trim() + '".', [textButton('Clear search', () => setQuery(''))]);
}
function sectionHeading(label) {
    return h('div', { class: 'np-section', role: 'presentation' }, label);
}
const CHUNK = 200;
const ROW_PX = 40;
/** Scroll offset the current render will be restored to; lets chunked lists render enough rows to reach it. */
let wantedScroll = 0;
/**
 * Appends `items` to `parent` CHUNK rows at a time, adding the next chunk as a sentinel scrolls near the view.
 * // ponytail: no virtualisation, so a 10k-track list ends up with 10k rows once scrolled to the bottom; add windowing if that lags.
 */
function renderChunked(parent, items, makeRow) {
    let shown = 0;
    const sentinel = h('div', { class: 'np-more', 'aria-hidden': 'true' });
    const observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting))
            more(CHUNK);
    }, { root: contentEl, rootMargin: '200px' });
    function more(count) {
        const next = items.slice(shown, shown + count);
        shown += next.length;
        const fragment = document.createDocumentFragment();
        for (const item of next)
            fragment.appendChild(makeRow(item));
        parent.insertBefore(fragment, sentinel);
        if (shown >= items.length) {
            observer.disconnect();
            sentinel.remove();
        }
        else {
            observer.unobserve(sentinel);
            observer.observe(sentinel); // re-fires while the sentinel is still on screen
        }
        updateRowFlags();
    }
    parent.appendChild(sentinel);
    more(Math.max(CHUNK, Math.ceil((wantedScroll + contentEl.clientHeight) / ROW_PX) + CHUNK / 2));
}
function textButton(label, onClick, primary) {
    const b = h('button', { class: 'np-text-btn' + (primary ? ' primary' : ''), type: 'button' }, label);
    b.addEventListener('click', onClick);
    return b;
}
/** Roving tabindex: one row is tabbable, ↑/↓ move focus, Enter activates. Alt+arrows are left for reordering. */
function makeRoving(list) {
    const rows = () => Array.prototype.slice.call(list.querySelectorAll('[data-row]'));
    const first = rows()[0];
    if (first)
        first.tabIndex = 0;
    list.addEventListener('focusin', (e) => {
        const target = e.target;
        if (!target.hasAttribute('data-row'))
            return;
        for (const r of rows())
            r.tabIndex = r === target ? 0 : -1;
    });
    list.addEventListener('keydown', (e) => {
        const target = e.target;
        if (!target.hasAttribute('data-row'))
            return;
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey) {
            e.preventDefault();
            const all = rows();
            const next = all[Math.max(0, Math.min(all.length - 1, all.indexOf(target) + (e.key === 'ArrowDown' ? 1 : -1)))];
            if (next)
                next.focus();
        }
        else if (e.key === 'Enter') {
            e.preventDefault();
            target.click();
        }
    });
}
/** Cheap in-place refresh of "playing", "unavailable" and the like toggles after a snapshot, without re-rendering lists. */
function updateRowFlags() {
    const s = app.player;
    const currentId = s && s.track ? s.track.id : '';
    const currentKey = app.queue.current ? String(app.queue.current.key) : '';
    document.querySelectorAll('[data-track-id]').forEach((node) => {
        const row = node;
        const id = row.getAttribute('data-track-id') || '';
        const key = row.getAttribute('data-key');
        row.classList.toggle('playing', key !== null ? key === currentKey : id === currentId);
        row.classList.toggle('unavailable', app.unavailable.has(id));
        const like = row.querySelector('.np-like');
        if (like)
            like.setAttribute('aria-pressed', String(app.liked.has(id)));
    });
}
const audio = h('audio', { id: 'audio-player', preload: 'auto' });
let audioTrackUri;
let pendingSeekMs = 0;
let lastTimePost = 0;
const bannerText = h('span', { class: 'np-banner-text' });
const bannerEl = h('div', { class: 'np-banner', role: 'status', hidden: true }, bannerText, iconButton('close', 'Dismiss', () => hideBanner()));
const autoplayEl = h('button', { class: 'np-autoplay', type: 'button', hidden: true }, 'Click here to start playback');
function showBanner(text) {
    bannerText.textContent = text;
    bannerEl.hidden = false;
}
function hideBanner() {
    bannerEl.hidden = true;
}
/** Start playback; report real failures, but not a play() that a pause() or a new load interrupted. */
function startPlayback(trackUri) {
    const promise = audio.play();
    if (promise === undefined)
        return;
    promise.catch((err) => {
        if (err.name === 'AbortError')
            return;
        const blocked = err.name === 'NotAllowedError';
        if (blocked)
            autoplayEl.hidden = false;
        else
            showBanner('Audio play failed: ' + err.message);
        send({ type: 'localAudioPlayFailed', error: err.name + ': ' + err.message, trackUri, silent: blocked });
    });
}
function durationMsOfAudio() {
    return Math.round((audio.duration || 0) * 1000) || (app.player ? app.player.durationMs : 0);
}
function initAudio() {
    autoplayEl.addEventListener('click', () => {
        audio.play().then(() => {
            autoplayEl.hidden = true;
        }).catch((err) => showBanner('Play failed: ' + err.message));
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
        if (!scrubDragging)
            updateScrubber(cur, durationMsOfAudio());
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
            if (err.code === 1)
                msg = 'Audio loading was aborted';
            else if (err.code === 2)
                msg = 'Network or filesystem error loading audio';
            else if (err.code === 3)
                msg = 'Audio decode error: format unsupported or file corrupted';
            else if (err.code === 4)
                msg = 'Audio source not supported or file inaccessible';
        }
        showBanner(msg);
        send({ type: 'localAudioError', error: msg, trackUri: audioTrackUri });
    });
}
/** Commands from WebviewAudioOutput on the host. */
function handleAudioMessage(msg) {
    switch (msg.type) {
        case 'localLoad':
            audioTrackUri = msg.trackUri;
            pendingSeekMs = msg.startMs > 0 ? msg.startMs : 0;
            hideBanner();
            if (msg.uri) {
                if (audio.src !== msg.uri) {
                    audio.src = msg.uri;
                }
                else {
                    audio.currentTime = pendingSeekMs / 1000;
                    pendingSeekMs = 0;
                }
                if (msg.autoplay)
                    startPlayback(msg.trackUri);
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
const scrub = h('div', { class: 'np-scrub', role: 'slider', tabindex: 0, 'aria-label': 'Seek', 'aria-valuemin': 0, 'aria-valuemax': 0, 'aria-valuenow': 0 }, h('div', { class: 'np-scrub-bar' }, scrubFill, scrubHandle));
const shuffleBtn = iconButton('shuffle', 'Shuffle', () => send({ type: 'toggleShuffle' }));
const prevBtn = iconButton('prev', 'Previous', () => send({ type: 'previous' }));
const playBtn = iconButton('play', 'Play', () => send({ type: 'playPause' }), 'np-play');
const nextBtn = iconButton('next', 'Next', () => send({ type: 'next' }));
const repeatBtn = iconButton('repeat', 'Repeat', () => send({ type: 'toggleRepeat' }), 'np-repeat');
const muteBtn = iconButton('volume', 'Mute', () => {
    const v = app.player ? app.player.volume : 0;
    if (v > 0)
        premuteVolume = v;
    send({ type: 'setVolume', volumePercent: v > 0 ? 0 : premuteVolume });
});
const volumeInput = h('input', { class: 'np-volume', type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Volume' });
volumeInput.addEventListener('input', () => send({ type: 'setVolume', volumePercent: Number(volumeInput.value) }));
artistBtn.addEventListener('click', () => {
    const t = app.player && app.player.track;
    if (t)
        openInLibrary('artist', artistKeyOf(t));
});
albumBtn.addEventListener('click', () => {
    const t = app.player && app.player.track;
    if (t)
        openInLibrary('album', albumKeyOf(t));
});
const playerEl = h('section', { class: 'np-player np-loading', 'aria-label': 'Now playing' }, coverSlot, h('div', { class: 'np-meta' }, h('div', { class: 'np-title-row' }, titleEl, likeBtn), h('div', { class: 'np-sub' }, artistBtn, sepEl, albumBtn)), h('div', { class: 'np-scrub-row' }, timeCur, scrub, timeDur), h('div', { class: 'np-controls' }, shuffleBtn, prevBtn, playBtn, nextBtn, repeatBtn), h('div', { class: 'np-volume-row' }, muteBtn, volumeInput), announcer);
function currentDurationMs() {
    return durationMsOfAudio();
}
function updateScrubber(curMs, durMs) {
    const pct = durMs > 0 ? Math.max(0, Math.min(100, (curMs / durMs) * 100)) : 0;
    scrubFill.style.width = pct + '%';
    scrubHandle.style.left = pct + '%';
    timeCur.textContent = formatTime(curMs);
    timeDur.textContent = formatTime(durMs);
    scrub.setAttribute('aria-valuemax', String(Math.round(durMs / 1000)));
    scrub.setAttribute('aria-valuenow', String(Math.round(curMs / 1000)));
    scrub.setAttribute('aria-valuetext', formatTime(curMs) + ' of ' + formatTime(durMs));
}
function scrubTargetMs(clientX) {
    const rect = scrub.getBoundingClientRect();
    const pct = rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
    return Math.round(pct * currentDurationMs());
}
scrub.addEventListener('pointerdown', (e) => {
    if (!currentDurationMs())
        return;
    scrubDragging = true;
    scrub.setPointerCapture(e.pointerId);
    scrub.classList.add('dragging');
    updateScrubber(scrubTargetMs(e.clientX), currentDurationMs());
});
scrub.addEventListener('pointermove', (e) => {
    if (scrubDragging)
        updateScrubber(scrubTargetMs(e.clientX), currentDurationMs());
});
scrub.addEventListener('pointerup', (e) => {
    if (!scrubDragging)
        return;
    scrubDragging = false;
    scrub.classList.remove('dragging');
    send({ type: 'seek', positionMs: scrubTargetMs(e.clientX) });
});
scrub.addEventListener('pointercancel', () => {
    scrubDragging = false;
    scrub.classList.remove('dragging');
});
scrub.addEventListener('keydown', (e) => {
    const dur = currentDurationMs();
    if (!dur)
        return;
    const pos = Math.round(audio.currentTime * 1000);
    let target = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown')
        target = pos - SEEK_STEP_MS;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp')
        target = pos + SEEK_STEP_MS;
    else if (e.key === 'Home')
        target = 0;
    else if (e.key === 'End')
        target = dur;
    if (target === null)
        return;
    e.preventDefault();
    send({ type: 'seek', positionMs: Math.max(0, Math.min(dur, target)) });
});
function renderPlayer() {
    const s = app.player;
    if (!s)
        return; // keep the skeleton until the first snapshot arrives
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
    if (document.activeElement !== volumeInput)
        volumeInput.value = String(s.volume);
    muteBtn.replaceChildren(icon(s.volume === 0 ? 'mute' : 'volume'));
    muteBtn.setAttribute('aria-label', s.volume === 0 ? 'Unmute' : 'Mute');
    muteBtn.title = s.volume === 0 ? 'Unmute' : 'Mute';
    // While playing, the audio element's timeupdate drives the scrubber; a snapshot only seeds it on a track change or when paused.
    const trackId = t ? t.id : '';
    if (!scrubDragging && (!s.isPlaying || scrubbedTrackId !== trackId))
        updateScrubber(s.progressMs, s.durationMs);
    scrubbedTrackId = trackId;
}
const headerEl = h('header', { class: 'np-header' }, h('div', { class: 'np-brand' }, h('span', { class: 'np-brand-mark', 'aria-hidden': 'true' }, '∅'), 'Music'));
function renderHeader() {
    // Nothing dynamic yet; Task 10 fills this in.
}
const contentEl = h('main', { class: 'np-content', id: 'np-content', role: 'tabpanel', tabindex: -1 });
const TABS = [
    ['queue', 'Queue'],
    ['library', 'Library'],
    ['playlists', 'Playlists'],
];
const tabButtons = {};
const tabsEl = h('nav', { class: 'np-tabs', role: 'tablist', 'aria-label': 'Music sections' });
for (const [id, label] of TABS) {
    const b = h('button', { class: 'np-tab', type: 'button', role: 'tab', id: 'np-tab-' + id }, label);
    b.addEventListener('click', () => setTab(id));
    tabButtons[id] = b;
    tabsEl.appendChild(b);
}
tabsEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')
        return;
    const at = TABS.findIndex((t) => t[0] === app.tab);
    const next = TABS[(at + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
    e.preventDefault();
    setTab(next);
    tabButtons[next].focus();
});
function setTab(tab) {
    app.tab = tab;
    for (const [id] of TABS) {
        const selected = id === tab;
        tabButtons[id].setAttribute('aria-selected', String(selected));
        tabButtons[id].tabIndex = selected ? 0 : -1;
    }
    contentEl.setAttribute('aria-labelledby', 'np-tab-' + tab);
    invalidate('content');
}
let lastViewKey = '';
function viewKey() {
    const detail = app.libraryDetail ? app.libraryDetail.kind + ':' + app.libraryDetail.id : '';
    return [app.tab, app.segment, detail, app.playlistId || '', app.showFolders ? 'folders' : ''].join('|');
}
/** Re-renders the active view, keeping the scroll position when it is the same view (or restoring it after "back"). */
function renderContent() {
    const key = viewKey();
    wantedScroll = key === lastViewKey ? contentEl.scrollTop : app.restoreScroll ? app.detailScroll : 0;
    lastViewKey = key;
    app.restoreScroll = false;
    const render = tabRenderers[app.tab];
    if (render)
        render(contentEl);
    contentEl.scrollTop = wantedScroll;
    updateRowFlags();
}
function trackIdOf(s) {
    return s && s.track ? s.track.id : '';
}
window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg.type !== 'string')
        return;
    switch (msg.type) {
        case 'player': {
            const previous = app.player;
            const unavailableKey = msg.unavailable.join(',');
            const flagsChanged = trackIdOf(previous) !== trackIdOf(msg.state) || unavailableKey !== app.unavailableKey;
            app.player = msg.state;
            app.unavailable = new Set(msg.unavailable);
            app.unavailableKey = unavailableKey;
            invalidate('player');
            if (flagsChanged)
                updateRowFlags();
            break;
        }
        case 'queue':
            app.queue = { history: msg.history, current: msg.current, upcoming: msg.upcoming, reorderable: msg.reorderable };
            if (app.tab === 'queue')
                invalidate('content');
            break;
        case 'library':
            app.tracks = msg.tracks;
            app.byId = new Map(msg.tracks.map((t) => [t.id, t]));
            app.folders = msg.folders;
            app.playlists = msg.playlists;
            app.scan = msg.scan;
            app.extensions = msg.extensions;
            app.libraryLoaded = true;
            invalidate('player');
            invalidate('header');
            invalidate('content');
            break;
        case 'liked':
            app.liked = new Set(msg.ids);
            updateRowFlags();
            if (app.likedOnly)
                invalidate('content');
            break;
        default:
            handleAudioMessage(msg);
    }
});
window.addEventListener('keydown', (e) => {
    const target = e.target;
    const role = target.getAttribute('role');
    const interactive = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].indexOf(target.tagName) >= 0 || role === 'slider' || role === 'tab';
    if (e.code === 'Space' && !interactive && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        send({ type: 'playPause' });
    }
});
const appRoot = document.getElementById('app');
appRoot.append(headerEl, playerEl, tabsEl, contentEl, bannerEl, autoplayEl, audio);
initAudio();
setTab('queue');
send({ type: 'ready' });
