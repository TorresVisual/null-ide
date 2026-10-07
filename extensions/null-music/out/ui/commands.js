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
exports.registerCommands = registerCommands;
const vscode = __importStar(require("vscode"));
const commandHelpers_1 = require("./commandHelpers");
function registerCommands(context, player, library) {
    const register = (command, callback) => {
        context.subscriptions.push(vscode.commands.registerCommand(command, callback));
    };
    const guarded = (fn) => async () => {
        try {
            await fn();
        }
        catch (err) {
            vscode.window.showErrorMessage(`Null Music: ${err.message || err}`);
        }
    };
    register('null-music.playPause', guarded(() => player.playPause()));
    register('null-music.play', guarded(() => player.play()));
    register('null-music.pause', guarded(() => player.pause()));
    register('null-music.nextTrack', guarded(() => player.next()));
    register('null-music.previousTrack', guarded(() => player.previous()));
    register('null-music.seek', async () => {
        const state = player.getState();
        if (!state.track) {
            vscode.window.showInformationMessage('No track currently playing to seek.');
            return;
        }
        const currentSec = Math.floor(state.progressMs / 1000);
        const durationSec = Math.floor(state.durationMs / 1000);
        const items = [
            { label: '$(playback-play) Forward 30 seconds', description: `+30s (to ${(0, commandHelpers_1.formatSec)(currentSec + 30)})` },
            { label: '$(playback-play) Rewind 30 seconds', description: `-30s (to ${(0, commandHelpers_1.formatSec)(Math.max(0, currentSec - 30))})` },
            { label: '$(playback-play) Forward 10 seconds', description: `+10s` },
            { label: '$(playback-play) Rewind 10 seconds', description: `-10s` },
            { label: '$(history) Restart Track', description: 'Go to 0:00' },
            { label: '$(edit) Custom Position (seconds or mm:ss)', description: 'Enter specific position' },
        ];
        const pick = await vscode.window.showQuickPick(items, {
            placeHolder: `Seek in current track (Current: ${(0, commandHelpers_1.formatSec)(currentSec)} / ${(0, commandHelpers_1.formatSec)(durationSec)})`,
        });
        if (!pick)
            return;
        if (pick.label.includes('Forward 30')) {
            player.seek(state.progressMs + 30000);
        }
        else if (pick.label.includes('Rewind 30')) {
            player.seek(Math.max(0, state.progressMs - 30000));
        }
        else if (pick.label.includes('Forward 10')) {
            player.seek(state.progressMs + 10000);
        }
        else if (pick.label.includes('Rewind 10')) {
            player.seek(Math.max(0, state.progressMs - 10000));
        }
        else if (pick.label.includes('Restart Track')) {
            player.seek(0);
        }
        else if (pick.label.includes('Custom Position')) {
            const input = await vscode.window.showInputBox({
                prompt: 'Enter position in seconds (e.g. 90) or mm:ss (e.g. 1:30)',
            });
            if (input) {
                const ms = (0, commandHelpers_1.parseTimeToMs)(input);
                if (ms !== null) {
                    player.seek(ms);
                }
                else {
                    vscode.window.showErrorMessage('Invalid time format. Please enter seconds or mm:ss.');
                }
            }
        }
    });
    register('null-music.setVolume', async () => {
        const items = [
            { label: '100%', description: 'Maximum volume' },
            { label: '75%', description: 'High volume' },
            { label: '50%', description: 'Medium volume' },
            { label: '25%', description: 'Low volume' },
            { label: '0%', description: 'Mute' },
            { label: '$(edit) Custom Volume (0-100%)', description: 'Enter custom volume percentage' },
        ];
        const pick = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select or enter volume level',
        });
        if (!pick)
            return;
        if (pick.label.includes('Custom Volume')) {
            const input = await vscode.window.showInputBox({
                prompt: 'Enter volume percentage (0 - 100)',
                validateInput: (v) => {
                    const num = parseInt(v, 10);
                    return isNaN(num) || num < 0 || num > 100 ? 'Please enter a number between 0 and 100' : null;
                },
            });
            if (input) {
                player.setVolume(parseInt(input, 10));
            }
        }
        else {
            player.setVolume(parseInt(pick.label, 10));
        }
    });
    register('null-music.volumeUp', () => player.adjustVolume(10));
    register('null-music.volumeDown', () => player.adjustVolume(-10));
    register('null-music.toggleShuffle', () => player.toggleShuffle());
    register('null-music.toggleRepeat', () => player.toggleRepeat());
    register('null-music.likeCurrentTrack', async () => {
        const track = player.getState().track;
        if (!track) {
            vscode.window.showInformationMessage('No track currently playing.');
            return;
        }
        const liked = await library.toggleLike(track.id);
        player.refresh();
        vscode.window.showInformationMessage(liked ? `Saved "${track.name}" to Liked Songs` : `Removed "${track.name}" from Liked Songs`);
    });
    register('null-music.showCurrentTrack', () => {
        const track = player.getState().track;
        if (!track) {
            vscode.window.showInformationMessage('Null Music: No track is currently playing.');
            return;
        }
        vscode.window.showInformationMessage(`Now Playing: ${track.name} by ${track.artist}`);
    });
    register('null-music.search', async () => {
        const query = await vscode.window.showInputBox({
            prompt: 'Search local music library by title, artist, or album',
            placeHolder: 'e.g. ambient, soundtrack, artist name…',
        });
        if (query === undefined)
            return;
        const matches = library.search(query);
        if (matches.length === 0) {
            vscode.window.showInformationMessage(`No tracks found matching "${query}".`);
            return;
        }
        const items = matches.map((t) => ({
            label: `$(play) ${t.name}`,
            description: t.artist,
            detail: t.album || undefined,
            trackUri: t.uri,
        }));
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Search results for "${query}" (select to play)`,
        });
        if (selected) {
            const all = library.tracks;
            const idx = all.findIndex((t) => t.uri === selected.trackUri);
            if (idx >= 0)
                await player.playTracks(all, idx);
        }
    });
    register('null-music.browsePlaylists', async () => {
        try {
            const collections = library.collections();
            if (collections.length === 0) {
                const choice = await vscode.window.showInformationMessage('No folders or playlists found. What would you like to add?', 'Import Playlist (.m3u8)', 'Add Music Folder');
                if (choice === 'Import Playlist (.m3u8)') {
                    await vscode.commands.executeCommand('null-music.importPlaylist');
                }
                else if (choice === 'Add Music Folder') {
                    await vscode.commands.executeCommand('null-music.openLocalFolder');
                }
                return;
            }
            const icons = { liked: '$(heart)', playlist: '$(list-ordered)', folder: '$(folder)' };
            const items = collections.map((c) => ({
                label: `${icons[c.kind]} ${c.name}`,
                description: `${c.tracks.length} track${c.tracks.length !== 1 ? 's' : ''}`,
                detail: c.detail,
                collection: c,
            }));
            const pick = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a playlist or folder to play',
            });
            if (pick && pick.collection.tracks.length > 0) {
                await player.playTracks(pick.collection.tracks, 0);
            }
        }
        catch (err) {
            vscode.window.showErrorMessage(`Null Music: ${err.message || err}`);
        }
    });
    register('null-music.importPlaylist', async () => {
        const files = await vscode.window.showOpenDialog({
            canSelectFolders: false,
            canSelectFiles: true,
            canSelectMany: false,
            filters: {
                'Playlists (*.m3u8, *.m3u)': ['m3u8', 'm3u'],
            },
            openLabel: 'Import Playlist',
            title: 'Select a .m3u8 or .m3u playlist file',
        });
        if (!files || files.length === 0)
            return;
        try {
            const playlist = await library.importPlaylist(files[0].fsPath || files[0].toString());
            if (playlist.tracks.length === 0) {
                vscode.window.showWarningMessage(`Playlist "${playlist.name}" was imported, but contained no tracks.`);
            }
            else {
                const action = await vscode.window.showInformationMessage(`Imported playlist "${playlist.name}" (${playlist.tracks.length} tracks)`, 'Play Now');
                if (action === 'Play Now') {
                    await player.playTracks(playlist.tracks, 0);
                }
            }
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to import playlist: ${err.message || err}`);
        }
    });
    register('null-music.openLocalFolder', async () => {
        const folders = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Add Music Folder',
            title: 'Select a folder containing audio files',
        });
        if (!folders || folders.length === 0)
            return;
        const tracks = await library.addFolder(folders[0].toString());
        if (tracks.length === 0) {
            vscode.window.showWarningMessage('No supported audio files found in that folder. Supported formats: MP3, FLAC, OGG, WAV, M4A, AAC, Opus.');
        }
        else {
            vscode.window.showInformationMessage(`Added ${tracks.length} track${tracks.length !== 1 ? 's' : ''} from "${folders[0].fsPath}"`);
        }
    });
    register('null-music.focus', async () => {
        await vscode.commands.executeCommand('null.musicView.focus');
    });
}
//# sourceMappingURL=commands.js.map