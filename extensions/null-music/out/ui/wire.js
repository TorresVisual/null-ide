/// <reference path="../webview/music/protocol.ts" />
'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.toWireTrack = toWireTrack;
exports.toWirePlayerState = toWirePlayerState;
exports.toWireQueue = toWireQueue;
exports.toWireLibrary = toWireLibrary;
const path = __importStar(require("path"));
const uri_1 = require("../uri");
function toWireTrack(t, artUrl) {
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
function toWirePlayerState(s, artUrl) {
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
function toWireQueue(s, shuffle, artUrl) {
    const item = (e) => ({ key: e.key, track: toWireTrack(e.track, artUrl) });
    return {
        type: 'queue',
        history: s.history.map(item),
        current: s.current ? item(s.current) : null,
        upcoming: s.upcoming.map(item),
        reorderable: !shuffle,
    };
}
function toWireLibrary(library, artUrl) {
    return {
        type: 'library',
        tracks: library.tracks.map((t) => toWireTrack(t, artUrl)),
        folders: library.folders.map((uri) => ({
            uri,
            name: path.basename((0, uri_1.uriToPath)(uri)) || uri,
            trackCount: library.tracksInFolder(uri).length,
        })),
        playlists: library.playlists.map((p) => ({ id: p.id, name: p.name, tracks: p.tracks.map((t) => toWireTrack(t, artUrl)) })),
        scan: library.progress,
        extensions: library.supportedExtensions,
    };
}
//# sourceMappingURL=wire.js.map