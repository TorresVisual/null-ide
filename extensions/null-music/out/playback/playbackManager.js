'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaybackManager = void 0;
class PlaybackManager {
    provider;
    getPollingIntervalMs;
    onNotification;
    currentState = null;
    lastTrackId = null;
    pollTimer = null;
    isDisposed = false;
    isPollingActive = false;
    stateListeners = new Set();
    trackChangeListeners = new Set();
    constructor(options) {
        this.provider = options.provider;
        this.getPollingIntervalMs = options.getPollingIntervalMs ?? (() => 2500);
        this.onNotification = options.onNotification;
        this.startPolling();
    }
    get activeProvider() {
        return this.provider;
    }
    getCurrentState() {
        if (!this.currentState) {
            return null;
        }
        if (this.currentState.isPlaying && this.currentState.timestamp > 0) {
            const elapsed = Date.now() - this.currentState.timestamp;
            const interpolatedProgress = Math.min(this.currentState.durationMs || Infinity, this.currentState.progressMs + elapsed);
            return {
                ...this.currentState,
                progressMs: interpolatedProgress,
            };
        }
        return this.currentState;
    }
    onDidChangePlaybackState(listener) {
        this.stateListeners.add(listener);
        return {
            dispose: () => this.stateListeners.delete(listener),
        };
    }
    onDidTrackChange(listener) {
        this.trackChangeListeners.add(listener);
        return {
            dispose: () => this.trackChangeListeners.delete(listener),
        };
    }
    async refreshNow() {
        try {
            const isAuth = await this.provider.isAuthenticated();
            if (!isAuth) {
                this.updateState(null);
                return null;
            }
            const state = await this.provider.getPlaybackState();
            this.updateState(state);
            return state;
        }
        catch {
            return this.currentState;
        }
    }
    updateState(newState) {
        const previousTrackId = this.lastTrackId;
        this.currentState = newState;
        const currentTrackId = newState?.track?.id ?? null;
        for (const listener of this.stateListeners) {
            try {
                listener(this.currentState);
            }
            catch (err) {
                console.error('Error in onDidChangePlaybackState listener:', err);
            }
        }
        if (currentTrackId !== previousTrackId) {
            this.lastTrackId = currentTrackId;
            for (const listener of this.trackChangeListeners) {
                try {
                    listener(newState?.track ?? null);
                }
                catch (err) {
                    console.error('Error in onDidTrackChange listener:', err);
                }
            }
            if (newState?.track && this.onNotification) {
                this.onNotification(`Now Playing: ${newState.track.name} • ${newState.track.artist}`);
            }
        }
    }
    startPolling() {
        if (this.isPollingActive || this.isDisposed) {
            return;
        }
        this.isPollingActive = true;
        const tick = async () => {
            if (this.isDisposed) {
                return;
            }
            await this.refreshNow();
            if (!this.isDisposed && this.isPollingActive) {
                const interval = Math.max(1000, this.getPollingIntervalMs());
                this.pollTimer = setTimeout(tick, interval);
            }
        };
        tick();
    }
    stopPolling() {
        this.isPollingActive = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }
    async playPause() {
        if (this.currentState?.isPlaying) {
            await this.provider.pause();
        }
        else {
            await this.provider.play();
        }
        await this.refreshNow();
    }
    async play(options) {
        await this.provider.play(options);
        await this.refreshNow();
    }
    async pause() {
        await this.provider.pause();
        await this.refreshNow();
    }
    async next() {
        await this.provider.next();
        await this.refreshNow();
    }
    async previous() {
        await this.provider.previous();
        await this.refreshNow();
    }
    async seek(positionMs) {
        await this.provider.seek(positionMs);
        if (this.currentState) {
            this.currentState.progressMs = positionMs;
            this.currentState.timestamp = Date.now();
            this.updateState(this.currentState);
        }
        await this.refreshNow();
    }
    async setVolume(volumePercent) {
        await this.provider.setVolume(volumePercent);
        if (this.currentState) {
            this.currentState.volume = Math.max(0, Math.min(100, volumePercent));
            this.updateState(this.currentState);
        }
        await this.refreshNow();
    }
    async volumeUp(step = 10) {
        const currentVol = this.currentState?.volume ?? 50;
        const target = Math.min(100, currentVol + step);
        await this.setVolume(target);
    }
    async volumeDown(step = 10) {
        const currentVol = this.currentState?.volume ?? 50;
        const target = Math.max(0, currentVol - step);
        await this.setVolume(target);
    }
    async toggleShuffle() {
        const nextState = !this.currentState?.shuffle;
        await this.provider.setShuffle(nextState);
        if (this.currentState) {
            this.currentState.shuffle = nextState;
            this.updateState(this.currentState);
        }
        await this.refreshNow();
    }
    async toggleRepeat() {
        const modes = ['off', 'context', 'track'];
        const currentMode = this.currentState?.repeat || 'off';
        const nextIndex = (modes.indexOf(currentMode) + 1) % modes.length;
        const nextMode = modes[nextIndex];
        await this.provider.setRepeatMode(nextMode);
        if (this.currentState) {
            this.currentState.repeat = nextMode;
            this.updateState(this.currentState);
        }
        await this.refreshNow();
    }
    async toggleLike() {
        const track = this.currentState?.track;
        if (!track?.id) {
            return false;
        }
        const currentLiked = !!track.isLiked;
        if (currentLiked) {
            await this.provider.removeTrack(track.id);
            track.isLiked = false;
        }
        else {
            await this.provider.saveTrack(track.id);
            track.isLiked = true;
        }
        this.updateState(this.currentState);
        return !currentLiked;
    }
    async getUserPlaylists() {
        return this.provider.getUserPlaylists();
    }
    async search(query) {
        return this.provider.search(query);
    }
    async getDevices() {
        return this.provider.getDevices();
    }
    async transferPlayback(deviceId) {
        await this.provider.transferPlayback(deviceId);
        await this.refreshNow();
    }
    dispose() {
        this.isDisposed = true;
        this.stopPolling();
        this.stateListeners.clear();
        this.trackChangeListeners.clear();
    }
}
exports.PlaybackManager = PlaybackManager;
//# sourceMappingURL=playbackManager.js.map