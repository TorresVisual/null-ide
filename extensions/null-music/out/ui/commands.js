"use strict";
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
function registerCommands(context, playbackManager, authStore) {
    const register = (command, callback) => {
        context.subscriptions.push(vscode.commands.registerCommand(command, callback));
    };
    register('null-music.playPause', async () => {
        try {
            await playbackManager.playPause();
        }
        catch (err) {
            vscode.window.showErrorMessage(`Null Music: ${err.message || err}`);
        }
    });
    register('null-music.play', async () => {
        try {
            await playbackManager.play();
        }
        catch (err) {
            vscode.window.showErrorMessage(`Null Music: ${err.message || err}`);
        }
    });
    register('null-music.pause', async () => {
        try {
            await playbackManager.pause();
        }
        catch (err) {
            vscode.window.showErrorMessage(`Null Music: ${err.message || err}`);
        }
    });
    register('null-music.nextTrack', async () => {
        try {
            await playbackManager.next();
        }
        catch (err) {
            vscode.window.showErrorMessage(`Null Music: ${err.message || err}`);
        }
    });
    register('null-music.previousTrack', async () => {
        try {
            await playbackManager.previous();
        }
        catch (err) {
            vscode.window.showErrorMessage(`Null Music: ${err.message || err}`);
        }
    });
    register('null-music.seek', async () => {
        const state = playbackManager.getCurrentState();
        if (!state?.track) {
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
            await playbackManager.seek(state.progressMs + 30000);
        }
        else if (pick.label.includes('Rewind 30')) {
            await playbackManager.seek(Math.max(0, state.progressMs - 30000));
        }
        else if (pick.label.includes('Forward 10')) {
            await playbackManager.seek(state.progressMs + 10000);
        }
        else if (pick.label.includes('Rewind 10')) {
            await playbackManager.seek(Math.max(0, state.progressMs - 10000));
        }
        else if (pick.label.includes('Restart Track')) {
            await playbackManager.seek(0);
        }
        else if (pick.label.includes('Custom Position')) {
            const input = await vscode.window.showInputBox({
                prompt: 'Enter position in seconds (e.g. 90) or mm:ss (e.g. 1:30)',
            });
            if (input) {
                const ms = (0, commandHelpers_1.parseTimeToMs)(input);
                if (ms !== null) {
                    await playbackManager.seek(ms);
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
                await playbackManager.setVolume(parseInt(input, 10));
            }
        }
        else {
            const vol = parseInt(pick.label, 10);
            await playbackManager.setVolume(vol);
        }
    });
    register('null-music.volumeUp', async () => {
        await playbackManager.volumeUp(10);
    });
    register('null-music.volumeDown', async () => {
        await playbackManager.volumeDown(10);
    });
    register('null-music.toggleShuffle', async () => {
        await playbackManager.toggleShuffle();
    });
    register('null-music.toggleRepeat', async () => {
        await playbackManager.toggleRepeat();
    });
    register('null-music.likeCurrentTrack', async () => {
        const state = playbackManager.getCurrentState();
        if (!state?.track) {
            vscode.window.showInformationMessage('No track currently playing.');
            return;
        }
        const isNowLiked = await playbackManager.toggleLike();
        if (isNowLiked) {
            vscode.window.showInformationMessage(`Saved "${state.track.name}" to Liked Songs`);
        }
        else {
            vscode.window.showInformationMessage(`Removed "${state.track.name}" from Liked Songs`);
        }
    });
    register('null-music.showCurrentTrack', () => {
        const state = playbackManager.getCurrentState();
        if (!state?.track) {
            vscode.window.showInformationMessage('Null Music: No track is currently playing.');
            return;
        }
        vscode.window.showInformationMessage(`Now Playing: ${state.track.name} by ${state.track.artist} (${state.track.album})`);
    });
    register('null-music.search', async () => {
        const query = await vscode.window.showInputBox({
            prompt: 'Search Spotify for songs, artists, albums, or playlists',
            placeHolder: 'e.g. Lofi coding, Hans Zimmer, Daft Punk...',
        });
        if (!query?.trim())
            return;
        const results = await playbackManager.search(query);
        const items = [];
        if (results.tracks.length > 0) {
            items.push({ label: 'SONGS', kind: vscode.QuickPickItemKind.Separator });
            for (const t of results.tracks) {
                items.push({
                    label: `$(play) ${t.name}`,
                    description: t.artist,
                    detail: `Album: ${t.album}`,
                    uri: t.uri,
                });
            }
        }
        if (results.playlists.length > 0) {
            items.push({ label: 'PLAYLISTS', kind: vscode.QuickPickItemKind.Separator });
            for (const p of results.playlists) {
                items.push({
                    label: `$(list-unordered) ${p.name}`,
                    description: `by ${p.owner} • ${p.trackCount} tracks`,
                    contextUri: p.uri,
                });
            }
        }
        if (results.albums.length > 0) {
            items.push({ label: 'ALBUMS', kind: vscode.QuickPickItemKind.Separator });
            for (const a of results.albums) {
                items.push({
                    label: `$(folder) ${a.name}`,
                    description: `${a.artist} • ${a.trackCount} tracks`,
                    contextUri: a.uri,
                });
            }
        }
        if (items.length === 0) {
            vscode.window.showInformationMessage(`No Spotify results found for "${query}"`);
            return;
        }
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Search results for "${query}" (select to play)`,
        });
        if (selected) {
            if (selected.uri) {
                await playbackManager.play({ uri: selected.uri });
            }
            else if (selected.contextUri) {
                await playbackManager.play({ contextUri: selected.contextUri });
            }
        }
    });
    register('null-music.browsePlaylists', async () => {
        try {
            const playlists = await playbackManager.getUserPlaylists();
            if (playlists.length === 0) {
                vscode.window.showInformationMessage('No playlists found in your library.');
                return;
            }
            const items = playlists.map((p) => ({
                label: `$(list-unordered) ${p.name}`,
                description: `${p.trackCount} tracks • by ${p.owner}`,
                detail: p.description || undefined,
                uri: p.uri,
            }));
            const pick = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a playlist to play',
            });
            if (pick) {
                await playbackManager.play({ contextUri: pick.uri });
            }
        }
        catch (err) {
            vscode.window.showErrorMessage(`Null Music: ${err.message || err}`);
        }
    });
    register('null-music.selectDevice', async () => {
        try {
            const devices = await playbackManager.getDevices();
            if (devices.length === 0) {
                vscode.window.showInformationMessage('No active Spotify devices found. Open Spotify on any device.');
                return;
            }
            const items = devices.map((d) => ({
                label: `${d.isActive ? '$(check) ' : ''}${d.name}`,
                description: `${d.type} • Volume: ${d.volumePercent}%`,
                deviceId: d.id,
            }));
            const pick = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select playback device to transfer playback to',
            });
            if (pick) {
                await playbackManager.transferPlayback(pick.deviceId);
                vscode.window.showInformationMessage(`Transferred playback to ${pick.label.replace('$(check) ', '')}`);
            }
        }
        catch (err) {
            vscode.window.showErrorMessage(`Null Music: ${err.message || err}`);
        }
    });
    register('null-music.signIn', async (providedClientId) => {
        const provider = playbackManager.activeProvider;
        if (!provider) {
            vscode.window.showErrorMessage('No active music provider.');
            return;
        }
        const config = vscode.workspace.getConfiguration('null-music.spotify');
        let clientId = typeof providedClientId === 'string' ? providedClientId.trim() : config.get('clientId', '').trim();
        if (typeof providedClientId === 'string' && providedClientId.trim()) {
            await config.update('clientId', providedClientId.trim(), vscode.ConfigurationTarget.Global);
            clientId = providedClientId.trim();
        }
        if (!clientId) {
            const choice = await vscode.window.showInformationMessage('To connect Spotify, enter your Spotify Developer App Client ID. (Takes 30 seconds to create free).', 'Enter Client ID', 'Open Developer Dashboard');
            if (choice === 'Open Developer Dashboard') {
                await vscode.env.openExternal(vscode.Uri.parse('https://developer.spotify.com/dashboard'));
            }
            const input = await vscode.window.showInputBox({
                prompt: 'Enter your Spotify Client ID (Set Redirect URI to http://127.0.0.1:8888/callback)',
                placeHolder: 'e.g. 1a2b3c4d5e6f7g8h9i0j...',
                ignoreFocusOut: true,
            });
            if (!input?.trim()) {
                return;
            }
            clientId = input.trim();
            await config.update('clientId', clientId, vscode.ConfigurationTarget.Global);
        }
        const success = await provider.authenticate();
        if (success) {
            vscode.window.showInformationMessage('Successfully connected to Spotify!');
            await playbackManager.refreshNow();
        }
        else {
            vscode.window.showWarningMessage('Spotify authentication was cancelled or failed.');
        }
    });
    register('null-music.configureSpotifyClientId', async () => {
        const config = vscode.workspace.getConfiguration('null-music.spotify');
        const current = config.get('clientId', '');
        const input = await vscode.window.showInputBox({
            prompt: 'Configure Spotify App Client ID (Redirect URI must be http://127.0.0.1:8888/callback)',
            value: current,
            placeHolder: 'Paste Client ID here...',
            ignoreFocusOut: true,
        });
        if (input !== undefined) {
            await config.update('clientId', input.trim(), vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('Spotify Client ID updated.');
        }
    });
    register('null-music.signOut', async () => {
        const choice = await vscode.window.showWarningMessage('Are you sure you want to disconnect your Spotify account from Null IDE?', 'Disconnect', 'Cancel');
        if (choice === 'Disconnect') {
            const provider = playbackManager.activeProvider;
            if (provider) {
                await provider.disconnect();
            }
            vscode.window.showInformationMessage('Disconnected Spotify account from Null IDE.');
        }
    });
    register('null-music.focus', async () => {
        await vscode.commands.executeCommand('null.musicView.focus');
    });
}
//# sourceMappingURL=commands.js.map