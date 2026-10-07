'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.MusicViewController = void 0;
/** Translates webview messages into Player/Library calls. Audio events go to WebviewAudioOutput, not here. */
class MusicViewController {
    player;
    library;
    messenger;
    host;
    constructor(player, library, messenger, host) {
        this.player = player;
        this.library = library;
        this.messenger = messenger;
        this.host = host;
    }
    async handleMessage(data) {
        if (!data || !data.type) {
            return;
        }
        try {
            switch (data.type) {
                case 'ready':
                    this.sendPlaybackState();
                    this.sendLocalLibrary();
                    break;
                case 'playPause':
                    await this.player.playPause();
                    break;
                case 'play':
                    await this.player.play();
                    break;
                case 'pause':
                    this.player.pause();
                    break;
                case 'previous':
                    await this.player.previous();
                    break;
                case 'next':
                    await this.player.next();
                    break;
                case 'seek':
                    if (typeof data.positionMs === 'number')
                        this.player.seek(data.positionMs);
                    break;
                case 'setVolume':
                    if (typeof data.volumePercent === 'number')
                        this.player.setVolume(data.volumePercent);
                    break;
                case 'toggleShuffle':
                    this.player.toggleShuffle();
                    break;
                case 'toggleRepeat':
                    this.player.toggleRepeat();
                    break;
                case 'toggleLike': {
                    const track = this.player.getState().track;
                    if (track)
                        await this.toggleLike(track.id);
                    break;
                }
                case 'toggleTrackLike':
                    if (data.trackId)
                        await this.toggleLike(data.trackId);
                    break;
                case 'localOpenFolder':
                    await this.host.executeCommand('null-music.openLocalFolder');
                    break;
                case 'localRemoveFolder':
                    if (data.folderUri)
                        await this.library.removeFolder(data.folderUri);
                    break;
                case 'localImportPlaylist':
                    await this.host.executeCommand('null-music.importPlaylist');
                    break;
                case 'localRemovePlaylist':
                    if (data.playlistId)
                        await this.library.removePlaylist(data.playlistId);
                    break;
                case 'localPlayTrack': {
                    const context = data.trackUri ? this.library.contextFor(data.trackUri) : undefined;
                    if (context)
                        await this.player.playTracks(context.tracks, context.index);
                    break;
                }
                case 'localPlayFolder':
                    if (data.folderUri)
                        await this.playAll(this.library.tracksInFolder(data.folderUri));
                    break;
                case 'localPlayPlaylist':
                    if (data.playlistId)
                        await this.playAll(this.library.playlistTracks(data.playlistId));
                    break;
                case 'localGetLibrary':
                    this.sendLocalLibrary();
                    break;
            }
        }
        catch (err) {
            this.host.showErrorMessage(`Null Music: ${err.message || err}`);
        }
    }
    sendPlaybackState() {
        this.messenger.postMessage({ type: 'stateUpdate', state: this.player.getState() });
    }
    sendLocalLibrary() {
        const tracks = this.library.tracks.map((t) => ({
            ...t,
            isLiked: this.library.isLiked(t.id),
            albumArtUrl: t.artKey ? this.host.artUrl(t.artKey) : undefined,
        }));
        this.messenger.postMessage({
            type: 'localLibraryUpdate',
            tracks,
            folders: this.library.folders,
            playlists: this.library.playlists,
            progress: this.library.progress,
        });
    }
    async toggleLike(trackId) {
        await this.library.toggleLike(trackId);
        this.player.refresh();
        this.sendLocalLibrary();
    }
    async playAll(tracks) {
        if (tracks.length > 0)
            await this.player.playTracks(tracks, 0);
    }
}
exports.MusicViewController = MusicViewController;
//# sourceMappingURL=musicViewController.js.map