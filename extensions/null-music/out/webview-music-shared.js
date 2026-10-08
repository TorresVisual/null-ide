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
