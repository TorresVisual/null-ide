'use strict';

import * as path from 'path';
import { Track } from '../types';
import { pathToUri, uriToPath } from '../uri';

export interface ParsedPlaylist {
  name: string;
  filePath: string;
  tracks: Track[];
}

export function parseM3u(content: string, playlistFilePath: string): ParsedPlaylist {
  // Strip UTF-8 BOM if present
  let cleanContent = content;
  if (cleanContent.charCodeAt(0) === 0xfeff) {
    cleanContent = cleanContent.slice(1);
  }

  const baseFileName = path.basename(playlistFilePath, path.extname(playlistFilePath)).trim();
  let playlistName = baseFileName || 'Imported Playlist';
  const playlistDir = path.dirname(playlistFilePath);

  const lines = cleanContent.split(/\r?\n/);
  const tracks: Track[] = [];

  let pendingDurationMs = 0;
  let pendingTitle = '';
  let pendingArtist = '';

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    if (rawLine.startsWith('#')) {
      const upper = rawLine.toUpperCase();
      if (upper.startsWith('#PLAYLIST:')) {
        playlistName = rawLine.slice(10).trim() || playlistName;
      } else if (upper.startsWith('#EXTALB:')) {
        playlistName = rawLine.slice(8).trim() || playlistName;
      } else if (upper.startsWith('#EXTINF:')) {
        // Format: #EXTINF:<duration>,<artist - title> or #EXTINF:<duration>,<title>
        const commaIdx = rawLine.indexOf(',');
        const durationPart = commaIdx >= 0 ? rawLine.slice(8, commaIdx).trim() : rawLine.slice(8).trim();
        const durationSec = parseFloat(durationPart);
        if (!isNaN(durationSec) && durationSec > 0) {
          pendingDurationMs = Math.round(durationSec * 1000);
        } else {
          pendingDurationMs = 0;
        }

        if (commaIdx >= 0) {
          const info = rawLine.slice(commaIdx + 1).trim();
          if (info.includes(' - ')) {
            const parts = info.split(' - ');
            pendingArtist = parts[0].trim();
            pendingTitle = parts.slice(1).join(' - ').trim();
          } else {
            pendingTitle = info;
            pendingArtist = '';
          }
        }
      }
      continue;
    }

    // This line is a track path or URL
    const trackPathOrUrl = rawLine;
    let uri: string;
    let trackFileName: string;

    if (trackPathOrUrl.startsWith('http://') || trackPathOrUrl.startsWith('https://')) {
      uri = trackPathOrUrl;
      try {
        const urlObj = new URL(trackPathOrUrl);
        trackFileName = path.basename(urlObj.pathname) || 'Stream Track';
      } catch {
        trackFileName = 'Stream Track';
      }
    } else if (trackPathOrUrl.startsWith('file://')) {
      uri = trackPathOrUrl;
      trackFileName = path.basename(uriToPath(trackPathOrUrl));
    } else {
      // Local filesystem path (either absolute or relative to playlist file)
      const isAbsolute = path.isAbsolute(trackPathOrUrl) || /^[A-Za-z]:[\\/]/.test(trackPathOrUrl);
      const resolvedFsPath = isAbsolute
        ? path.normalize(trackPathOrUrl)
        : path.normalize(path.resolve(playlistDir, trackPathOrUrl));
      uri = pathToUri(resolvedFsPath);
      trackFileName = path.basename(resolvedFsPath);
    }

    let trackTitle = pendingTitle;
    let trackArtist = pendingArtist;

    if (!trackTitle) {
      const ext = path.extname(trackFileName);
      let base = path.basename(trackFileName, ext).trim();
      base = base.replace(/^\d+[\s.\-_]+/, '');
      if (base.includes(' - ')) {
        const parts = base.split(' - ');
        trackArtist = trackArtist || parts[0].trim();
        trackTitle = parts.slice(1).join(' - ').trim();
      } else {
        trackTitle = base || 'Track ' + (tracks.length + 1);
      }
    }

    if (!trackArtist) {
      trackArtist = playlistName || 'Unknown Artist';
    }

    tracks.push({
      id: `local:${uri}`,
      name: trackTitle,
      artist: trackArtist,
      artists: [trackArtist],
      album: '',
      durationMs: pendingDurationMs,
      uri,
    });

    // Reset pending
    pendingDurationMs = 0;
    pendingTitle = '';
    pendingArtist = '';
  }

  return {
    name: playlistName,
    filePath: playlistFilePath,
    tracks,
  };
}

export function serializeM3u(playlistName: string, tracks: Track[]): string {
  const lines: string[] = ['#EXTM3U', `#PLAYLIST:${playlistName}`];
  for (const track of tracks) {
    const durationSec = track.durationMs > 0 ? Math.round(track.durationMs / 1000) : -1;
    lines.push(`#EXTINF:${durationSec},${track.artist} - ${track.name}`);
    lines.push(track.uri);
  }
  return lines.join('\n');
}
