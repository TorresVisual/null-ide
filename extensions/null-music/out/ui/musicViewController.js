'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.MusicViewController = void 0;
class MusicViewController {
    playbackManager;
    localProvider;
    messenger;
    host;
    constructor(playbackManager, localProvider, messenger, host) {
        this.playbackManager = playbackManager;
        this.localProvider = localProvider;
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
                    this.sendPlaybackState(this.playbackManager.getCurrentState());
                    await this.sendLocalLibrary();
                    break;
                case 'playPause':
                    await this.playbackManager.playPause();
                    break;
                case 'play':
                    await this.playbackManager.play();
                    break;
                case 'pause':
                    await this.playbackManager.pause();
                    break;
                case 'previous':
                    await this.playbackManager.previous();
                    break;
                case 'next':
                    await this.playbackManager.next();
                    break;
                case 'seek':
                    if (typeof data.positionMs === 'number') {
                        await this.playbackManager.seek(data.positionMs);
                    }
                    break;
                case 'setVolume':
                    if (typeof data.volumePercent === 'number') {
                        await this.playbackManager.setVolume(data.volumePercent);
                    }
                    break;
                case 'toggleShuffle':
                    await this.playbackManager.toggleShuffle();
                    break;
                case 'toggleRepeat':
                    await this.playbackManager.toggleRepeat();
                    break;
                case 'toggleLike':
                    await this.playbackManager.toggleLike();
                    await this.sendLocalLibrary();
                    break;
                case 'toggleTrackLike':
                    if (data.trackId) {
                        const isLiked = await this.localProvider.isLiked(data.trackId);
                        if (isLiked) {
                            await this.localProvider.removeTrack(data.trackId);
                        }
                        else {
                            await this.localProvider.saveTrack(data.trackId);
                        }
                        await this.sendLocalLibrary();
                        await this.playbackManager.refreshNow();
                    }
                    break;
                case 'localOpenFolder':
                    await this.host.executeCommand('null-music.openLocalFolder');
                    await this.sendLocalLibrary();
                    break;
                case 'localRemoveFolder':
                    if (data.folderUri) {
                        await this.localProvider.removeFolder(data.folderUri);
                        await this.sendLocalLibrary();
                    }
                    break;
                case 'localPlayTrack':
                    if (data.trackUri) {
                        const allTracks = this.localProvider.getAllTracks();
                        const idx = allTracks.findIndex((t) => t.uri === data.trackUri);
                        if (idx >= 0) {
                            this.localProvider.queueAndPlay(allTracks, idx);
                            await this.playbackManager.refreshNow();
                        }
                    }
                    break;
                case 'localPlayFolder':
                    if (data.folderUri) {
                        await this.playbackManager.play({
                            contextUri: `local:folder:${encodeURIComponent(data.folderUri)}`,
                        });
                    }
                    break;
                case 'localGetLibrary':
                    await this.sendLocalLibrary();
                    break;
                case 'localAudioDuration':
                    if (typeof data.durationMs === 'number') {
                        this.localProvider.notifyDuration(data.durationMs, data.trackUri);
                        await this.playbackManager.refreshNow();
                    }
                    break;
                case 'localAudioEnded':
                    await this.localProvider.notifyEnded();
                    await this.playbackManager.refreshNow();
                    break;
            }
        }
        catch (err) {
            this.host.showErrorMessage(`Null Music: ${err.message || err}`);
        }
    }
    sendPlaybackState(state) {
        this.messenger.postMessage({ type: 'stateUpdate', state });
    }
    async sendLocalLibrary() {
        const rawTracks = this.localProvider.getAllTracks();
        const tracks = await Promise.all(rawTracks.map(async (t) => ({
            ...t,
            isLiked: await this.localProvider.isLiked(t.id),
        })));
        const folders = this.localProvider.getFolderUris();
        this.messenger.postMessage({ type: 'localLibraryUpdate', tracks, folders });
    }
}
exports.MusicViewController = MusicViewController;
//# sourceMappingURL=musicViewController.js.map