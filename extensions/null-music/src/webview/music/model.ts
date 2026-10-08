'use strict';

type SortKey = 'title' | 'artist' | 'album' | 'duration';

interface Album {
  key: string;
  name: string;
  artist: string;
  year?: number;
  artUrl?: string;
  tracks: WireTrack[];
}

interface Artist {
  key: string;
  name: string;
  artUrl?: string;
  albums: Album[];
  tracks: WireTrack[];
}

const UNKNOWN_ARTIST = 'Unknown artist';
const UNKNOWN_ALBUM = 'Unknown album';
const SEPARATOR = /[\s\-_.,/()\[\]]/;

function formatTime(ms: number): string {
  if (!(ms > 0)) return '0:00';
  const total = Math.floor(ms / 1000);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const ss = secs < 10 ? '0' + secs : String(secs);
  if (hrs > 0) return hrs + ':' + (mins < 10 ? '0' + mins : String(mins)) + ':' + ss;
  return mins + ':' + ss;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

function artistOf(t: WireTrack): string {
  return (t.albumArtist || t.artist || '').trim() || UNKNOWN_ARTIST;
}

/** Stable ids the player's artist/album links and the Library detail views use. */
function artistKeyOf(t: WireTrack): string {
  return artistOf(t).toLowerCase();
}

function albumKeyOf(t: WireTrack): string {
  return artistKeyOf(t) + '\u0000' + (t.album.trim() || UNKNOWN_ALBUM).toLowerCase();
}

/** Disc, then track number (untagged last), then title. */
function albumOrder(a: WireTrack, b: WireTrack): number {
  const na = a.trackNo === undefined ? 1e9 : a.trackNo;
  const nb = b.trackNo === undefined ? 1e9 : b.trackNo;
  return (a.discNo || 1) - (b.discNo || 1) || na - nb || compareText(a.name, b.name);
}

function sortTracks(tracks: WireTrack[], key: SortKey): WireTrack[] {
  const by: Record<SortKey, (a: WireTrack, b: WireTrack) => number> = {
    title: (a, b) => compareText(a.name, b.name),
    artist: (a, b) => compareText(a.artist, b.artist) || compareText(a.name, b.name),
    album: (a, b) => compareText(a.album, b.album) || albumOrder(a, b),
    duration: (a, b) => a.durationMs - b.durationMs || compareText(a.name, b.name),
  };
  return tracks.slice().sort(by[key]);
}

function groupAlbums(tracks: WireTrack[]): Album[] {
  const map = new Map<string, Album>();
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
    if (album.year === undefined && t.year) album.year = t.year;
    if (!album.artUrl && t.artUrl) album.artUrl = t.artUrl;
  }
  const out = Array.from(map.values());
  for (const a of out) a.tracks.sort(albumOrder);
  return out.sort((a, b) => compareText(a.name, b.name) || compareText(a.artist, b.artist));
}

function groupArtists(tracks: WireTrack[]): Artist[] {
  const map = new Map<string, { name: string; tracks: WireTrack[] }>();
  for (const t of tracks) {
    const key = artistKeyOf(t);
    const entry = map.get(key);
    if (entry) entry.tracks.push(t);
    else map.set(key, { name: artistOf(t), tracks: [t] });
  }
  const out: Artist[] = [];
  map.forEach((entry, key) => {
    const albums = groupAlbums(entry.tracks);
    const ordered: WireTrack[] = [];
    let artUrl: string | undefined;
    for (const a of albums) {
      for (const t of a.tracks) ordered.push(t);
      if (!artUrl && a.artUrl) artUrl = a.artUrl;
    }
    out.push({ key, name: entry.name, artUrl, albums, tracks: ordered });
  });
  return out.sort((a, b) => compareText(a.name, b.name));
}

/** 3 = prefix, 2 = starts a word, 1 = elsewhere, 0 = no match. Plain indexOf: the query is never a pattern. */
function scoreText(text: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  let best = 0;
  let from = 0;
  for (;;) {
    const at = t.indexOf(q, from);
    if (at < 0) return best;
    if (at === 0) return 3;
    if (SEPARATOR.test(t.charAt(at - 1))) best = 2;
    else if (best === 0) best = 1;
    from = at + 1;
  }
}

/** Keeps matching items, best first (ties keep list order). The first field outranks the others. */
function rankItems<T>(items: T[], query: string, fields: (item: T) => string[]): T[] {
  if (!query.trim()) return items;
  const scored: Array<{ item: T; score: number; i: number }> = [];
  items.forEach((item, i) => {
    const f = fields(item);
    let rest = 0;
    for (let k = 1; k < f.length; k++) rest = Math.max(rest, scoreText(f[k], query));
    const score = scoreText(f[0], query) * 10 + rest;
    if (score > 0) scored.push({ item, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((s) => s.item);
}

function rankTracks(tracks: WireTrack[], query: string): WireTrack[] {
  return rankItems(tracks, query, (t) => [t.name, t.artist, t.album]);
}

/** For views that must keep their order (queue, album detail): does the track match at all? Blank query matches everything. */
function matchesTrack(t: WireTrack, query: string): boolean {
  return !query.trim() || scoreText(t.name, query) + scoreText(t.artist, query) + scoreText(t.album, query) > 0;
}

function highlightRanges(text: string, query: string): Array<[number, number]> {
  const q = query.trim().toLowerCase();
  const out: Array<[number, number]> = [];
  if (!q) return out;
  const t = text.toLowerCase();
  let from = 0;
  for (;;) {
    const at = t.indexOf(q, from);
    if (at < 0) return out;
    out.push([at, at + q.length]);
    from = at + q.length;
  }
}

function placeholderHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function resolveTracks(ids: string[], byId: Map<string, WireTrack>): WireTrack[] {
  const out: WireTrack[] = [];
  for (const id of ids) {
    const t = byId.get(id);
    if (t) out.push(t);
  }
  return out;
}

/** The `beforeKey` for moving `key` one slot up/down among `keys`; undefined when it cannot move. */
function reorderTarget(keys: number[], key: number, dir: -1 | 1): number | null | undefined {
  const at = keys.indexOf(key);
  if (at < 0) return undefined;
  if (dir === -1) return at === 0 ? undefined : keys[at - 1];
  if (at === keys.length - 1) return undefined;
  return at + 2 < keys.length ? keys[at + 2] : null;
}
