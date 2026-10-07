'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.NULL_MUSIC_COMMANDS = void 0;
exports.formatSec = formatSec;
exports.parseTimeToMs = parseTimeToMs;
function formatSec(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}
function parseTimeToMs(input) {
    const trimmed = input.trim();
    if (/^\d+$/.test(trimmed)) {
        return parseInt(trimmed, 10) * 1000;
    }
    const parts = trimmed.split(':');
    if (parts.length === 2) {
        const m = parseInt(parts[0], 10);
        const s = parseInt(parts[1], 10);
        if (!isNaN(m) && !isNaN(s) && m >= 0 && s >= 0 && s < 60) {
            return (m * 60 + s) * 1000;
        }
    }
    return null;
}
exports.NULL_MUSIC_COMMANDS = [
    'null-music.playPause',
    'null-music.play',
    'null-music.pause',
    'null-music.nextTrack',
    'null-music.previousTrack',
    'null-music.seek',
    'null-music.setVolume',
    'null-music.volumeUp',
    'null-music.volumeDown',
    'null-music.toggleShuffle',
    'null-music.toggleRepeat',
    'null-music.likeCurrentTrack',
    'null-music.showCurrentTrack',
    'null-music.search',
    'null-music.browsePlaylists',
    'null-music.selectDevice',
    'null-music.signIn',
    'null-music.signOut',
    'null-music.configureSpotifyClientId',
    'null-music.focus',
];
//# sourceMappingURL=commandHelpers.js.map