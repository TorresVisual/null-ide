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
exports.parseM3u = parseM3u;
exports.serializeM3u = serializeM3u;
const path = __importStar(require("path"));
let vscodeModule;
try {
    vscodeModule = require('vscode');
}
catch {
    vscodeModule = {
        Uri: {
            file: (fsPath) => ({
                fsPath,
                toString: () => `file:///${fsPath.replace(/\\/g, '/')}`,
            }),
            parse: (val) => ({
                toString: () => val,
                fsPath: val.replace(/^file:\/\/\/?/, '').replace(/\//g, path.sep),
            }),
        },
    };
}
function parseM3u(content, playlistFilePath) {
    // Strip UTF-8 BOM if present
    let cleanContent = content;
    if (cleanContent.charCodeAt(0) === 0xfeff) {
        cleanContent = cleanContent.slice(1);
    }
    const baseFileName = path.basename(playlistFilePath, path.extname(playlistFilePath)).trim();
    let playlistName = baseFileName || 'Imported Playlist';
    const playlistDir = path.dirname(playlistFilePath);
    const lines = cleanContent.split(/\r?\n/);
    const tracks = [];
    let pendingDurationMs = 0;
    let pendingTitle = '';
    let pendingArtist = '';
    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i].trim();
        if (!rawLine)
            continue;
        if (rawLine.startsWith('#')) {
            const upper = rawLine.toUpperCase();
            if (upper.startsWith('#PLAYLIST:')) {
                playlistName = rawLine.slice(10).trim() || playlistName;
            }
            else if (upper.startsWith('#EXTALB:')) {
                playlistName = rawLine.slice(8).trim() || playlistName;
            }
            else if (upper.startsWith('#EXTINF:')) {
                // Format: #EXTINF:<duration>,<artist - title> or #EXTINF:<duration>,<title>
                const commaIdx = rawLine.indexOf(',');
                const durationPart = commaIdx >= 0 ? rawLine.slice(8, commaIdx).trim() : rawLine.slice(8).trim();
                const durationSec = parseFloat(durationPart);
                if (!isNaN(durationSec) && durationSec > 0) {
                    pendingDurationMs = Math.round(durationSec * 1000);
                }
                else {
                    pendingDurationMs = 0;
                }
                if (commaIdx >= 0) {
                    const info = rawLine.slice(commaIdx + 1).trim();
                    if (info.includes(' - ')) {
                        const parts = info.split(' - ');
                        pendingArtist = parts[0].trim();
                        pendingTitle = parts.slice(1).join(' - ').trim();
                    }
                    else {
                        pendingTitle = info;
                        pendingArtist = '';
                    }
                }
            }
            continue;
        }
        // This line is a track path or URL
        const trackPathOrUrl = rawLine;
        let uri;
        let trackFileName;
        if (trackPathOrUrl.startsWith('http://') || trackPathOrUrl.startsWith('https://')) {
            uri = trackPathOrUrl;
            try {
                const urlObj = new URL(trackPathOrUrl);
                trackFileName = path.basename(urlObj.pathname) || 'Stream Track';
            }
            catch {
                trackFileName = 'Stream Track';
            }
        }
        else if (trackPathOrUrl.startsWith('file://')) {
            uri = trackPathOrUrl;
            const parsed = vscodeModule.Uri.parse(trackPathOrUrl);
            trackFileName = path.basename(parsed.fsPath || trackPathOrUrl);
        }
        else {
            // Local filesystem path (either absolute or relative to playlist file)
            const isAbsolute = path.isAbsolute(trackPathOrUrl) || /^[A-Za-z]:[\\/]/.test(trackPathOrUrl);
            const resolvedFsPath = isAbsolute
                ? path.normalize(trackPathOrUrl)
                : path.normalize(path.resolve(playlistDir, trackPathOrUrl));
            if (vscodeModule.Uri?.file) {
                uri = vscodeModule.Uri.file(resolvedFsPath).toString();
            }
            else {
                uri = `file:///${resolvedFsPath.replace(/\\/g, '/')}`;
            }
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
            }
            else {
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
            album: playlistName,
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
function serializeM3u(playlistName, tracks) {
    const lines = ['#EXTM3U', `#PLAYLIST:${playlistName}`];
    for (const track of tracks) {
        const durationSec = track.durationMs > 0 ? Math.round(track.durationMs / 1000) : -1;
        lines.push(`#EXTINF:${durationSec},${track.artist} - ${track.name}`);
        lines.push(track.uri);
    }
    return lines.join('\n');
}
//# sourceMappingURL=m3uParser.js.map