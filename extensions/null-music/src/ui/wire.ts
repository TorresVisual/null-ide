/// <reference path="../webview/music/protocol.ts" />
'use strict';

import * as path from 'path';
import { Library } from '../library/library';
import { Entry, QueueSnapshot } from '../playback/queue';
import { PlaybackState, Track } from '../types';
import { uriToPath } from '../uri';

/** Maps an art-directory file name to a URL the webview may load. */
export type ArtUrl = (artKey: string) => string | undefined;

export function toWireTrack(t: Track, artUrl: ArtUrl): WireTrack {
  return {
    id: t.id,
    name: t.name,
    artist: t.artist,
    album: t.album,
    albumArtist: t.albumArtist,
    trackNo: t.trackNo,
    discNo: t.discNo,
    year: t.year,
    durationMs: t.durationMs,
    artUrl: t.artKey ? artUrl(t.artKey) : undefined,
  };
}

export function toWirePlayerState(s: PlaybackState, artUrl: ArtUrl): WirePlayerState {
  return {
    isPlaying: s.isPlaying,
    track: s.track ? toWireTrack(s.track, artUrl) : null,
    liked: !!s.track?.isLiked,
    progressMs: s.progressMs,
    durationMs: s.durationMs,
    volume: s.volume,
    shuffle: s.shuffle,
    repeat: s.repeat,
    timestamp: s.timestamp,
  };
}

export function toWireQueue(s: QueueSnapshot, shuffle: boolean, artUrl: ArtUrl): Extract<HostToWebview, { type: 'queue' }> {
  const item = (e: Entry): WireQueueItem => ({ key: e.key, track: toWireTrack(e.track, artUrl) });
  return {
    type: 'queue',
    history: s.history.map(item),
    current: s.current ? item(s.current) : null,
    upcoming: s.upcoming.map(item),
    reorderable: !shuffle,
  };
}

export function toWireLibrary(library: Library, artUrl: ArtUrl): Extract<HostToWebview, { type: 'library' }> {
  return {
    type: 'library',
    tracks: library.tracks.map((t) => toWireTrack(t, artUrl)),
    folders: library.folders.map((uri) => ({
      uri,
      name: path.basename(uriToPath(uri)) || uri,
      trackCount: library.tracksInFolder(uri).length,
    })),
    playlists: library.playlists.map((p) => ({ id: p.id, name: p.name, tracks: p.tracks.map((t) => toWireTrack(t, artUrl)) })),
    scan: { ...library.progress, active: library.isScanning },
    extensions: library.supportedExtensions,
  };
}
