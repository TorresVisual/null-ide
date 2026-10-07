'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaybackManager = void 0;
class PlaybackManager {
    providerRegistry;
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
        this.providerRegistry = options.providerRegistry;
        this.getPollingIntervalMs = options.getPollingIntervalMs ?? (() => 2500);
        this.onNotification = options.onNotification;
        this.providerRegistry.onDidChangeActiveProvider(() => {
            this.refreshNow();
        });
        this.startPolling();
    }
    get activeProvider() {
        return this.providerRegistry.getActiveProvider();
    }
    getCurrentState() {
        if (!this.currentState) {
            return null;
        }
        // Interpolate progress if currently playing
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
        const provider = this.activeProvider;
        if (!provider) {
            this.updateState(null);
            return null;
        }
        try {
            const isAuth = await provider.isAuthenticated();
            if (!isAuth) {
                this.updateState(null);
                return null;
            }
            const state = await provider.getPlaybackState();
            this.updateState(state);
            return state;
        }
        catch (err) {
            // Don't clear state on transient network blip
            return this.currentState;
        }
    }
    updateState(newState) {
        const previousTrackId = this.lastTrackId;
        this.currentState = newState;
        const currentTrackId = newState?.track?.id ?? null;
        // Fire state listeners
        for (const listener of this.stateListeners) {
            try {
                listener(this.currentState);
            }
            catch (err) {
                console.error('Error in onDidChangePlaybackState listener:', err);
            }
        }
        // Fire track change listeners if song changed
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
        const provider = this.ensureActiveProvider();
        if (this.currentState?.isPlaying) {
            await provider.pause();
        }
        else {
            await provider.play();
        }
        await this.refreshNow();
    }
    async play(options) {
        const provider = this.ensureActiveProvider();
        await provider.play(options);
        await this.refreshNow();
    }
    async pause() {
        const provider = this.ensureActiveProvider();
        await provider.pause();
        await this.refreshNow();
    }
    async next() {
        const provider = this.ensureActiveProvider();
        await provider.next();
        await this.refreshNow();
    }
    async previous() {
        const provider = this.ensureActiveProvider();
        await provider.previous();
        await this.refreshNow();
    }
    async seek(positionMs) {
        const provider = this.ensureActiveProvider();
        await provider.seek(positionMs);
        if (this.currentState) {
            this.currentState.progressMs = positionMs;
            this.currentState.timestamp = Date.now();
            this.updateState(this.currentState);
        }
        await this.refreshNow();
    }
    async setVolume(volumePercent) {
        const provider = this.ensureActiveProvider();
        await provider.setVolume(volumePercent);
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
        const provider = this.ensureActiveProvider();
        const nextState = !this.currentState?.shuffle;
        await provider.setShuffle(nextState);
        if (this.currentState) {
            this.currentState.shuffle = nextState;
            this.updateState(this.currentState);
        }
        await this.refreshNow();
    }
    async toggleRepeat() {
        const provider = this.ensureActiveProvider();
        const modes = ['off', 'context', 'track'];
        const currentMode = this.currentState?.repeat || 'off';
        const nextIndex = (modes.indexOf(currentMode) + 1) % modes.length;
        const nextMode = modes[nextIndex];
        await provider.setRepeatMode(nextMode);
        if (this.currentState) {
            this.currentState.repeat = nextMode;
            this.updateState(this.currentState);
        }
        await this.refreshNow();
    }
    async toggleLike() {
        const provider = this.ensureActiveProvider();
        const track = this.currentState?.track;
        if (!track?.id) {
            return false;
        }
        const currentLiked = !!track.isLiked;
        if (currentLiked) {
            await provider.removeTrack(track.id);
            track.isLiked = false;
        }
        else {
            await provider.saveTrack(track.id);
            track.isLiked = true;
        }
        this.updateState(this.currentState);
        return !currentLiked;
    }
    async getUserPlaylists() {
        const provider = this.ensureActiveProvider();
        return provider.getUserPlaylists();
    }
    async search(query) {
        const provider = this.ensureActiveProvider();
        return provider.search(query);
    }
    async getDevices() {
        const provider = this.ensureActiveProvider();
        return provider.getDevices();
    }
    async transferPlayback(deviceId) {
        const provider = this.ensureActiveProvider();
        await provider.transferPlayback(deviceId);
        await this.refreshNow();
    }
    ensureActiveProvider() {
        const provider = this.activeProvider;
        if (!provider) {
            throw new Error('No active music provider available');
        }
        return provider;
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