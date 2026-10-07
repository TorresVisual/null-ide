'use strict';

import { PlaybackState, Track } from './types';

export function makeSampleTrack(overrides?: Partial<Track>): Track {
  return {
    id: 'track-123',
    name: 'Ambient Coding',
    artist: 'Null Artist',
    artists: ['Null Artist'],
    album: 'd:/Music/Code',
    durationMs: 180000,
    uri: 'file:///d:/Music/Code/AmbientCoding.mp3',
    isLiked: false,
    ...overrides,
  };
}

export function makeSamplePlaybackState(overrides?: Partial<PlaybackState>): PlaybackState {
  return {
    isPlaying: true,
    track: makeSampleTrack(),
    progressMs: 45000,
    durationMs: 180000,
    volume: 80,
    shuffle: false,
    repeat: 'off',
    timestamp: Date.now(),
    ...overrides,
  };
}
