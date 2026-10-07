'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatTime = formatTime;
exports.buildStatusBarModel = buildStatusBarModel;
function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}
function buildStatusBarModel(state, formatPattern = '${title} - ${artist}') {
    if (!state || !state.track) {
        return {
            text: '$(music) Music',
            tooltipText: 'Null Music: No active playback. Click to open player.',
            isPlaying: false,
        };
    }
    const track = state.track;
    const formatted = formatPattern
        .replace('${title}', track.name)
        .replace('${artist}', track.artist)
        .replace('${album}', track.album)
        .replace('${device}', state.device?.name || '');
    const icon = state.isPlaying ? '$(play)' : '$(debug-pause)';
    const progressSec = Math.floor((state.progressMs || 0) / 1000);
    const durationSec = Math.floor((state.durationMs || 0) / 1000);
    const tooltip = [
        `### $(music) **${track.name}**`,
        `**Artist:** ${track.artist}`,
        `**Album:** ${track.album}`,
        `**Progress:** \`${formatTime(progressSec)} / ${formatTime(durationSec)}\``,
        state.device ? `**Device:** ${state.device.name} (${state.device.volumePercent}% vol)` : '',
        '---',
        `[$(chevron-left) Prev](command:null-music.previousTrack) | [${state.isPlaying ? '$(debug-pause) Pause' : '$(play) Play'}](command:null-music.playPause) | [$(chevron-right) Next](command:null-music.nextTrack) | [${track.isLiked ? '$(heart) Liked' : '$(heart) Like'}](command:null-music.likeCurrentTrack)`,
        '*Click status bar to open Music panel*',
    ]
        .filter(Boolean)
        .join('\n\n');
    return {
        text: `${icon} ${formatted}`,
        tooltipText: tooltip,
        isPlaying: state.isPlaying,
    };
}
//# sourceMappingURL=statusBarModel.js.map