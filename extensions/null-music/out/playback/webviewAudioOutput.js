'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebviewAudioOutput = void 0;
const emitter_1 = require("../emitter");
class WebviewAudioOutput {
    host;
    emitter = new emitter_1.Emitter();
    onEvent = this.emitter.event;
    view;
    ready = false;
    waiters = [];
    constructor(host) {
        this.host = host;
    }
    get isReady() {
        return this.ready;
    }
    /** A freshly resolved view has not loaded its script yet: wait for its `ready` message. */
    attach(view) {
        this.view = view;
        this.ready = false;
    }
    /** The view went away; whatever was playing stopped with it. */
    detach() {
        const wasAttached = this.view !== undefined;
        this.view = undefined;
        this.ready = false;
        if (wasAttached)
            this.emitter.fire({ type: 'pause' });
    }
    handleMessage(data) {
        switch (data?.type) {
            case 'ready':
                this.ready = true;
                this.emitter.fire({ type: 'ready' });
                for (const resolve of this.waiters.splice(0))
                    resolve();
                break;
            case 'localAudioPlayStarted':
                this.emitter.fire({ type: 'play' });
                break;
            case 'localAudioPaused':
                this.emitter.fire({ type: 'pause', positionMs: this.num(data.positionMs), trackUri: data.trackUri });
                break;
            case 'localAudioTimeUpdate':
                if (typeof data.positionMs === 'number') {
                    this.emitter.fire({ type: 'time', positionMs: data.positionMs, trackUri: data.trackUri });
                }
                break;
            case 'localAudioDuration':
                if (typeof data.durationMs === 'number') {
                    this.emitter.fire({ type: 'duration', durationMs: data.durationMs, trackUri: data.trackUri });
                }
                break;
            case 'localAudioEnded':
                this.emitter.fire({ type: 'ended', trackUri: data.trackUri });
                break;
            case 'localAudioError':
            case 'localAudioPlayFailed':
                this.emitter.fire({ type: 'error', message: data.error || 'Playback error', silent: !!data.silent, trackUri: data.trackUri });
                break;
        }
    }
    async ensureReady(timeoutMs) {
        if (this.ready)
            return;
        const ready = new Promise((resolve) => this.waiters.push(resolve));
        if (!this.view)
            this.host.revealView().catch(() => { });
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('no response from the player view')), timeoutMs);
        });
        try {
            await Promise.race([ready, timeout]);
        }
        finally {
            clearTimeout(timer);
        }
    }
    load(track, opts) {
        const isStream = /^https?:/i.test(track.uri);
        this.post({
            type: 'localLoad',
            uri: isStream || !this.view ? track.uri : this.view.resolveUri(track.uri),
            trackUri: track.uri,
            startMs: opts.startMs,
            autoplay: opts.autoplay,
        });
    }
    play() {
        this.post({ type: 'localResume' });
    }
    pause() {
        this.post({ type: 'localPause' });
    }
    seek(positionMs) {
        this.post({ type: 'localSeek', positionMs });
    }
    setVolume(volumePercent) {
        this.post({ type: 'localVolume', volumePercent });
    }
    post(message) {
        try {
            void this.view?.postMessage(message);
        }
        catch {
            // a disposed webview throws; the next `ready` resynchronises
        }
    }
    num(v) {
        return typeof v === 'number' ? v : undefined;
    }
}
exports.WebviewAudioOutput = WebviewAudioOutput;
//# sourceMappingURL=webviewAudioOutput.js.map