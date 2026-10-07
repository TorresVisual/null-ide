'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMusicWebviewHtml = getMusicWebviewHtml;
function getMusicWebviewHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: http: vscode-resource: vscode-webview-resource:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; media-src vscode-resource: vscode-webview-resource: https: blob:;">
  <title>Null Music</title>
  <style>
    :root {
      --null-bg: #0d0d1a;
      --null-card-bg: #16162a;
      --null-card-hover: #1f1f3a;
      --null-border: #282848;
      --null-text: #f0f0f8;
      --null-text-muted: #8e8ea8;
      --null-accent: #00b4d8;
      --null-accent-hover: #48cae4;
      --null-accent-dark: #0077b6;
      --null-brand-spotify: #1db954;
      --null-brand-spotify-hover: #1ed760;
      --null-danger: #ef4444;
      --null-heart: #f43f5e;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      user-select: none;
    }

    body {
      background-color: var(--null-bg);
      color: var(--null-text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow-x: hidden;
      overflow-y: auto;
    }

    /* Scrollbars */
    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: var(--null-border);
      border-radius: 3px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: var(--null-text-muted);
    }

    /* Tabs Header */
    .tabs-header {
      display: flex;
      gap: 4px;
      background: var(--null-card-bg);
      border: 1px solid var(--null-border);
      border-radius: 8px;
      padding: 3px;
      margin-bottom: 12px;
    }

    .tab-btn {
      flex: 1;
      padding: 6px 8px;
      border: none;
      background: transparent;
      color: var(--null-text-muted);
      font-size: 11px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      transition: all 0.15s ease;
    }

    .tab-btn.active {
      background: var(--null-accent-dark);
      color: #ffffff;
      box-shadow: 0 2px 6px rgba(0, 180, 216, 0.25);
    }

    .tab-btn:hover:not(.active) {
      color: var(--null-text);
      background: var(--null-card-hover);
    }

    .tab-pane {
      display: none;
      flex-direction: column;
      gap: 12px;
    }

    .tab-pane.active {
      display: flex;
    }

    /* Auth Banner / Disconnected State */
    .auth-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 32px 16px;
      background: var(--null-card-bg);
      border: 1px solid var(--null-border);
      border-radius: 12px;
      gap: 14px;
      margin-top: 10px;
    }

    .spotify-logo-svg {
      width: 48px;
      height: 48px;
      fill: var(--null-brand-spotify);
    }

    .auth-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--null-text);
    }

    .auth-desc {
      font-size: 12px;
      color: var(--null-text-muted);
      line-height: 1.5;
    }

    .spotify-connect-btn {
      background-color: var(--null-brand-spotify);
      color: #000000;
      border: none;
      border-radius: 24px;
      padding: 10px 24px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s ease;
      box-shadow: 0 4px 12px rgba(29, 185, 84, 0.3);
    }

    .spotify-connect-btn:hover {
      background-color: var(--null-brand-spotify-hover);
      transform: scale(1.03);
    }

    /* Player Card */
    .player-card {
      background: var(--null-card-bg);
      border: 1px solid var(--null-border);
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
      position: relative;
    }

    .album-art-wrapper {
      position: relative;
      width: 160px;
      height: 160px;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
      background: #111122;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .album-art {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .album-art-placeholder {
      width: 48px;
      height: 48px;
      opacity: 0.3;
      fill: var(--null-text);
    }

    .track-info {
      width: 100%;
      text-align: center;
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 0 4px;
    }

    .track-title {
      font-size: 14px;
      font-weight: 700;
      color: var(--null-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .track-artist {
      font-size: 12px;
      font-weight: 500;
      color: var(--null-accent);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .track-album {
      font-size: 11px;
      color: var(--null-text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Progress & Scrubber */
    .progress-section {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .progress-bar-container {
      width: 100%;
      height: 16px;
      display: flex;
      align-items: center;
      cursor: pointer;
    }

    .progress-bar-track {
      position: relative;
      width: 100%;
      height: 4px;
      background: var(--null-border);
      border-radius: 2px;
      overflow: hidden;
      transition: height 0.15s ease;
    }

    .progress-bar-container:hover .progress-bar-track {
      height: 6px;
    }

    .progress-bar-fill {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 0%;
      background: var(--null-accent);
      border-radius: 2px;
      transition: width 0.1s linear;
    }

    .progress-times {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: var(--null-text-muted);
      font-family: monospace;
    }

    /* Control Buttons */
    .controls-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      width: 100%;
    }

    .control-btn {
      background: transparent;
      border: none;
      color: var(--null-text);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      padding: 8px;
      transition: all 0.15s ease;
    }

    .control-btn svg {
      width: 18px;
      height: 18px;
      fill: currentColor;
    }

    .control-btn:hover {
      color: var(--null-accent);
      background: var(--null-card-hover);
      transform: scale(1.1);
    }

    .control-btn.active {
      color: var(--null-accent);
    }

    .control-btn.btn-play-pause {
      background: var(--null-accent);
      color: #ffffff;
      padding: 12px;
      box-shadow: 0 4px 12px rgba(0, 180, 216, 0.4);
    }

    .control-btn.btn-play-pause svg {
      width: 20px;
      height: 20px;
      fill: #ffffff;
    }

    .control-btn.btn-play-pause:hover {
      background: var(--null-accent-hover);
      transform: scale(1.1);
    }

    .control-btn.btn-heart {
      color: var(--null-text-muted);
    }

    .control-btn.btn-heart.liked {
      color: var(--null-heart);
    }

    .control-btn.btn-heart.liked svg {
      fill: var(--null-heart);
    }

    /* Volume Slider */
    .volume-row {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 0 8px;
    }

    .volume-row svg {
      width: 14px;
      height: 14px;
      fill: var(--null-text-muted);
    }

    .volume-slider {
      flex: 1;
      -webkit-appearance: none;
      height: 4px;
      background: var(--null-border);
      border-radius: 2px;
      outline: none;
      cursor: pointer;
    }

    .volume-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 12px;
      height: 12px;
      background: var(--null-accent);
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    }

    /* Device Badge */
    .device-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(0, 180, 216, 0.1);
      border: 1px solid rgba(0, 180, 216, 0.2);
      border-radius: 12px;
      padding: 4px 10px;
      font-size: 11px;
      color: var(--null-accent);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .device-badge:hover {
      background: rgba(0, 180, 216, 0.2);
    }

    .device-badge svg {
      width: 12px;
      height: 12px;
      fill: currentColor;
    }

    /* Playlists / Search Lists */
    .list-container {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .search-box {
      width: 100%;
      padding: 8px 12px;
      background: var(--null-card-bg);
      border: 1px solid var(--null-border);
      border-radius: 8px;
      color: var(--null-text);
      font-size: 12px;
      outline: none;
      transition: border-color 0.15s;
    }

    .search-box:focus {
      border-color: var(--null-accent);
    }

    .section-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--null-text-muted);
      margin: 8px 0 4px 0;
    }

    .item-card {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 8px;
      background: var(--null-card-bg);
      border: 1px solid transparent;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .item-card:hover {
      background: var(--null-card-hover);
      border-color: var(--null-border);
    }

    .item-thumb {
      width: 40px;
      height: 40px;
      border-radius: 6px;
      object-fit: cover;
      background: #111122;
      flex-shrink: 0;
    }

    .item-details {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .item-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--null-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .item-subtitle {
      font-size: 11px;
      color: var(--null-text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .item-action-btn {
      background: transparent;
      border: none;
      color: var(--null-accent);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 6px;
      border-radius: 50%;
      opacity: 0;
      transition: opacity 0.15s;
    }

    .item-card:hover .item-action-btn {
      opacity: 1;
    }

    .item-action-btn svg {
      width: 14px;
      height: 14px;
      fill: currentColor;
    }

    .empty-msg {
      text-align: center;
      color: var(--null-text-muted);
      font-size: 12px;
      padding: 24px 0;
    }

    .footer-account {
      margin-top: auto;
      padding-top: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: var(--null-text-muted);
      border-top: 1px solid var(--null-border);
    }

    .disconnect-link {
      color: var(--null-danger);
      text-decoration: none;
      cursor: pointer;
    }

    .disconnect-link:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>

  <!-- Top Service Switcher -->
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; padding: 2px 2px;">
    <span style="font-size: 11px; font-weight: 700; color: var(--null-text-muted); letter-spacing: 0.5px;">SERVICE:</span>
    <select id="select-provider" class="search-box" style="width: auto; padding: 3px 8px; font-size: 11px; height: 26px; border-radius: 6px; cursor: pointer;">
      <option value="spotify">Spotify</option>
      <option value="lofi">Null Lo-Fi Radio (Free)</option>
      <option value="local">📁 Local Music</option>
    </select>
  </div>

  <audio id="audio-player" preload="none" style="display: none;"></audio>

  <!-- Authenticated Header Navigation -->
  <div id="tabs-header" class="tabs-header" style="display: none;">
    <button class="tab-btn active" data-tab="now-playing">
      <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M6 3.5v9l7-4.5z"/></svg>
      Player
    </button>
    <button class="tab-btn" data-tab="playlists">
      <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M2 3h12v2H2zm0 4h12v2H2zm0 4h8v2H2z"/></svg>
      Stations / Playlists
    </button>
    <button class="tab-btn" data-tab="library" id="tab-library" style="display: none;">
      <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zm8 0A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm-8 8A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm8 0A1.5 1.5 0 0 1 10.5 9h3A1.5 1.5 0 0 1 15 10.5v3A1.5 1.5 0 0 1 13.5 15h-3A1.5 1.5 0 0 1 9 13.5v-3z"/></svg>
      Library
    </button>
    <button class="tab-btn" data-tab="search">
      <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/></svg>
      Search
    </button>
    <button class="tab-btn" data-tab="devices">
      <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M11 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h6zM5 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H5z"/></svg>
      Devices
    </button>
  </div>

  <!-- Sign In State -->
  <div id="auth-view" class="auth-container">
    <svg class="spotify-logo-svg" viewBox="0 0 24 24">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.48.66.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
    <div class="auth-title">Spotify for Null IDE</div>
    <div class="auth-desc">Listen and control your Spotify music seamlessly inside Null IDE.</div>

    <div style="width: 100%; display: flex; flex-direction: column; gap: 6px; text-align: left;">
      <label style="font-size: 11px; font-weight: 600; color: var(--null-text-muted);">Spotify App Client ID:</label>
      <input id="input-client-id" class="search-box" type="text" placeholder="Paste your Spotify Client ID here..." />
    </div>

    <button id="btn-sign-in" class="spotify-connect-btn" style="width: 100%; justify-content: center;">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.48.66.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
      </svg>
      Connect Spotify
    </button>

    <button id="btn-switch-lofi" style="width: 100%; background: transparent; border: 1px solid var(--null-border); color: var(--null-accent); border-radius: 24px; padding: 8px 16px; font-weight: 600; font-size: 12px; cursor: pointer;">
      🎵 Or Listen Free with Null Lo-Fi Radio
    </button>

    <details style="width: 100%; text-align: left; background: var(--null-bg); border: 1px solid var(--null-border); border-radius: 8px; padding: 10px; font-size: 11px; color: var(--null-text-muted);">
      <summary style="font-weight: 600; color: var(--null-accent); cursor: pointer; outline: none;">Spotify App Setup Guide</summary>
      <ol style="margin: 8px 0 0 16px; line-height: 1.6;">
        <li>Open the <a id="link-dev-dash" style="color: var(--null-accent); text-decoration: underline; cursor: pointer;">Spotify Developer Dashboard</a></li>
        <li>Click <b>Create App</b> (Name: <code>Null IDE</code>)</li>
        <li>Set Redirect URI: <code style="user-select: text; color: #fff; background: var(--null-card-bg); padding: 2px 4px; border-radius: 3px;">http://127.0.0.1:8888/callback</code></li>
        <li>Check <b>Web API</b>, click Save, and copy your <b>Client ID</b>.</li>
        <li style="margin-top: 4px; color: #f59e0b;">Note: Spotify Developer apps require a Spotify Premium account. If you don't have Premium, use Null Lo-Fi Radio above!</li>
      </ol>
    </details>
  </div>

  <!-- Now Playing Pane -->
  <div id="pane-now-playing" class="tab-pane active" style="display: none;">
    <div class="player-card">
      <div class="album-art-wrapper">
        <img id="player-art" class="album-art" style="display: none;" alt="Album Cover" />
        <svg id="player-placeholder" class="album-art-placeholder" viewBox="0 0 16 16"><path d="M12 1v8.55A3.5 3.5 0 1 0 13 12V3h2V1h-3zM5.5 14A2.5 2.5 0 1 1 8 11.5 2.5 2.5 0 0 1 5.5 14zm6.5-2a2.5 2.5 0 1 1 2.5-2.5 2.5 2.5 0 0 1-2.5 2.5z"/></svg>
      </div>

      <div class="track-info">
        <div id="player-title" class="track-title">No Track Playing</div>
        <div id="player-artist" class="track-artist">Start playing Spotify to see info</div>
        <div id="player-album" class="track-album"></div>
      </div>

      <!-- Progress -->
      <div class="progress-section">
        <div id="progress-bar-container" class="progress-bar-container">
          <div class="progress-bar-track">
            <div id="progress-bar-fill" class="progress-bar-fill"></div>
          </div>
        </div>
        <div class="progress-times">
          <span id="time-current">0:00</span>
          <span id="time-duration">0:00</span>
        </div>
      </div>

      <!-- Controls -->
      <div class="controls-row">
        <button id="btn-shuffle" class="control-btn" title="Toggle Shuffle">
          <svg viewBox="0 0 16 16"><path d="M12.5 1.5l3 3-3 3V5H11c-1.3 0-2.4.6-3.2 1.6l-.6.7c-1 1.2-2.3 2-3.8 2H1v-2h2.4c.8 0 1.6-.4 2.2-1.1l.6-.7C7.3 4.2 8.8 3.3 10.5 3.3H12.5V1.5zM1 9.7h2.4c.5 0 1 .1 1.4.3l-.7 1.8c-.2-.1-.5-.1-.7-.1H1V9.7zm9.5-3.4c.5 0 1 .1 1.5.2V5l3 3-3 3v-1.5h-2c-1.3 0-2.4-.6-3.2-1.6l.6-.7c.8 1 1.9 1.6 3.1 1.6h1.5z"/></svg>
        </button>

        <button id="btn-prev" class="control-btn" title="Previous Track">
          <svg viewBox="0 0 16 16"><path d="M3.5 2v12h1.5V8.8l7.5 5.2V2L5 7.2V2H3.5z"/></svg>
        </button>

        <button id="btn-play-pause" class="control-btn btn-play-pause" title="Play / Pause">
          <svg id="icon-play" viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>
          <svg id="icon-pause" viewBox="0 0 16 16" style="display: none;"><path d="M3.5 2.5h3v11h-3zm6 0h3v11h-3z"/></svg>
        </button>

        <button id="btn-next" class="control-btn" title="Next Track">
          <svg viewBox="0 0 16 16"><path d="M12.5 2v12H11V8.8L3.5 14V2L11 7.2V2h1.5z"/></svg>
        </button>

        <button id="btn-repeat" class="control-btn" title="Toggle Repeat Mode">
          <svg viewBox="0 0 16 16"><path d="M11 1v2H4.5C2.6 3 1 4.6 1 6.5S2.6 10 4.5 10H5V8.5h-.5C3.4 8.5 2.5 7.6 2.5 6.5S3.4 4.5 4.5 4.5H11V6.5l3.5-2.75L11 1zm.5 5H11v1.5h.5c1.1 0 2 .9 2 2s-.9 2-2 2H5V9.5L1.5 12.25 5 15v-2h6.5c1.9 0 3.5-1.6 3.5-3.5S13.4 6 11.5 6z"/></svg>
        </button>

        <button id="btn-like" class="control-btn btn-heart" title="Save / Like Track">
          <svg viewBox="0 0 16 16"><path d="M8 14s-6-3.8-6-8a4 4 0 0 1 6.8-2.8L8 4.3l.2-.1A4 4 0 0 1 15 6c0 4.2-6 8-6 8z"/></svg>
        </button>
      </div>

      <!-- Volume -->
      <div class="volume-row">
        <svg viewBox="0 0 16 16"><path d="M8.5 2.2L4.3 6H1.5C1.2 6 1 6.2 1 6.5v3c0 .3.2.5.5.5h2.8l4.2 3.8c.4.3.9 0 .9-.5v-10.6c0-.5-.5-.8-.9-.5zM11.5 8c0-1.3-.7-2.4-1.8-3v6c1.1-.6 1.8-1.7 1.8-3zm1.5 0c0 2.2-1.3 4.1-3.3 5v1.6c3-.9 5-3.8 5-6.6s-2-5.7-5-6.6V3c2 .9 3.3 2.8 3.3 5z"/></svg>
        <input id="volume-slider" class="volume-slider" type="range" min="0" max="100" value="100" />
      </div>

      <!-- Device Badge -->
      <div id="device-badge" class="device-badge">
        <svg viewBox="0 0 16 16"><path d="M11 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h6zM5 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H5z"/></svg>
        <span id="device-name">No Active Device</span>
      </div>
    </div>
  </div>

  <!-- Playlists Pane -->
  <div id="pane-playlists" class="tab-pane">
    <div class="section-title">Your Playlists</div>
    <div id="playlists-list" class="list-container">
      <div class="empty-msg">Loading playlists…</div>
    </div>
  </div>

  <!-- Library Pane (Local Music) -->
  <div id="pane-library" class="tab-pane">
    <div style="display: flex; align-items: center; justify-content: space-between;">
      <div class="section-title" style="margin: 0;">Local Library</div>
      <button id="btn-add-folder" style="background: var(--null-accent-dark); border: none; color: #fff; border-radius: 6px; padding: 4px 10px; font-size: 11px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm8-3.5a.5.5 0 0 1 .5.5v2.5H11a.5.5 0 0 1 0 1H8.5V11a.5.5 0 0 1-1 0V8.5H5a.5.5 0 0 1 0-1h2.5V5a.5.5 0 0 1 .5-.5z"/></svg>
        Add Folder
      </button>
    </div>
    <div id="local-folders-list" class="list-container" style="gap: 4px;"></div>
    <div class="section-title" id="local-tracks-header" style="display: none;">Tracks</div>
    <div id="local-tracks-list" class="list-container"></div>
    <div id="local-empty-msg" class="empty-msg">No folders added yet. Click "Add Folder" to scan your music library.</div>
  </div>

  <!-- Search Pane -->
  <div id="pane-search" class="tab-pane">
    <input id="search-input" class="search-box" type="text" placeholder="Search songs, artists, albums, playlists…" />
    <div id="search-results" class="list-container">
      <div class="empty-msg">Type above to search Spotify</div>
    </div>
  </div>

  <!-- Devices Pane -->
  <div id="pane-devices" class="tab-pane">
    <div class="section-title">Available Spotify Devices</div>
    <div id="devices-list" class="list-container">
      <div class="empty-msg">Loading devices…</div>
    </div>
  </div>

  <!-- Footer Account -->
  <div id="footer-account" class="footer-account" style="display: none;">
    <span id="account-name">Connected</span>
    <a id="link-disconnect" class="disconnect-link">Disconnect</a>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    let currentState = null;
    let progressTimer = null;
    let isDraggingProgress = false;
    let searchDebounce = null;

    // Elements
    const tabsHeader = document.getElementById('tabs-header');
    const authView = document.getElementById('auth-view');
    const footerAccount = document.getElementById('footer-account');
    const accountName = document.getElementById('account-name');
    const linkDisconnect = document.getElementById('link-disconnect');

    const paneNowPlaying = document.getElementById('pane-now-playing');
    const panePlaylists = document.getElementById('pane-playlists');
    const paneLibrary = document.getElementById('pane-library');
    const paneSearch = document.getElementById('pane-search');
    const paneDevices = document.getElementById('pane-devices');
    const tabLibrary = document.getElementById('tab-library');

    // Local library elements
    const btnAddFolder = document.getElementById('btn-add-folder');
    const localFoldersList = document.getElementById('local-folders-list');
    const localTracksList = document.getElementById('local-tracks-list');
    const localTracksHeader = document.getElementById('local-tracks-header');
    const localEmptyMsg = document.getElementById('local-empty-msg');

    const btnSignIn = document.getElementById('btn-sign-in');
    const btnPlayPause = document.getElementById('btn-play-pause');
    const iconPlay = document.getElementById('icon-play');
    const iconPause = document.getElementById('icon-pause');
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const btnShuffle = document.getElementById('btn-shuffle');
    const btnRepeat = document.getElementById('btn-repeat');
    const btnLike = document.getElementById('btn-like');

    const playerArt = document.getElementById('player-art');
    const playerPlaceholder = document.getElementById('player-placeholder');
    const playerTitle = document.getElementById('player-title');
    const playerArtist = document.getElementById('player-artist');
    const playerAlbum = document.getElementById('player-album');

    const progressBarContainer = document.getElementById('progress-bar-container');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const timeCurrent = document.getElementById('time-current');
    const timeDuration = document.getElementById('time-duration');
    const volumeSlider = document.getElementById('volume-slider');
    const deviceBadge = document.getElementById('device-badge');
    const deviceName = document.getElementById('device-name');

    const playlistsList = document.getElementById('playlists-list');
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    const devicesList = document.getElementById('devices-list');

    const inputClientId = document.getElementById('input-client-id');
    const linkDevDash = document.getElementById('link-dev-dash');

    // Local audio element
    const audioPlayer = document.getElementById('audio-player');
    let currentProviderId = 'spotify';

    // Tab Switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const tab = btn.dataset.tab;
        [paneNowPlaying, panePlaylists, paneLibrary, paneSearch, paneDevices].forEach(p => {
          if (p) { p.classList.remove('active'); p.style.display = 'none'; }
        });

        if (tab === 'now-playing') {
          paneNowPlaying.classList.add('active');
          paneNowPlaying.style.display = 'flex';
        } else if (tab === 'playlists') {
          panePlaylists.classList.add('active');
          panePlaylists.style.display = 'flex';
          vscode.postMessage({ type: 'getPlaylists' });
        } else if (tab === 'library') {
          paneLibrary.classList.add('active');
          paneLibrary.style.display = 'flex';
          vscode.postMessage({ type: 'localGetLibrary' });
        } else if (tab === 'search') {
          paneSearch.classList.add('active');
          paneSearch.style.display = 'flex';
          searchInput.focus();
        } else if (tab === 'devices') {
          paneDevices.classList.add('active');
          paneDevices.style.display = 'flex';
          vscode.postMessage({ type: 'getDevices' });
        }
      });
    });

    // Formatting helper
    function formatTime(ms) {
      if (!ms || ms < 0) return '0:00';
      const totalSeconds = Math.floor(ms / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
    }

    // UI Updates
    function updateAuthState(isAuthenticated, user, clientId, providerId) {
      currentProviderId = providerId || 'spotify';
      const isLocal = currentProviderId === 'local';
      const isLofi = currentProviderId === 'lofi';

      // Sync the service dropdown to reflect the active provider
      const providerSelect = document.getElementById('select-provider');
      if (providerSelect) {
        providerSelect.value = currentProviderId;
      }

      // Show/hide Library tab only for local provider
      if (tabLibrary) {
        tabLibrary.style.display = isLocal ? 'flex' : 'none';
      }

      if (isAuthenticated) {
        authView.style.display = 'none';
        tabsHeader.style.display = 'flex';
        paneNowPlaying.style.display = 'flex';
        footerAccount.style.display = isLocal ? 'none' : 'flex';
        if (!isLocal && !isLofi) {
          accountName.textContent = user?.name ? 'Logged in as ' + user.name : 'Connected to Spotify';
        } else if (isLofi) {
          accountName.textContent = 'Null Lo-Fi Radio — Free';
        }

        // If switching to local, auto-navigate to Library tab
        if (isLocal && tabLibrary) {
          tabLibrary.click();
        }
      } else {
        authView.style.display = 'flex';
        tabsHeader.style.display = 'none';
        paneNowPlaying.style.display = 'none';
        panePlaylists.style.display = 'none';
        if (paneLibrary) paneLibrary.style.display = 'none';
        paneSearch.style.display = 'none';
        paneDevices.style.display = 'none';
        footerAccount.style.display = 'none';
        if (inputClientId && clientId) {
          inputClientId.value = clientId;
        }
      }
    }

    function renderPlaybackState(state) {
      currentState = state;
      if (!state || !state.track) {
        playerArt.style.display = 'none';
        playerPlaceholder.style.display = 'block';
        playerTitle.textContent = 'No Track Playing';
        if (currentProviderId === 'local') {
          playerArtist.textContent = 'Pick a track from your Library tab to listen';
        } else if (currentProviderId === 'lofi') {
          playerArtist.textContent = 'Press play to start Lo-Fi radio';
        } else {
          playerArtist.textContent = 'Start playback on Spotify to listen';
        }
        playerAlbum.textContent = '';
        iconPlay.style.display = 'block';
        iconPause.style.display = 'none';
        progressBarFill.style.width = '0%';
        timeCurrent.textContent = '0:00';
        timeDuration.textContent = '0:00';
        deviceName.textContent = 'No Active Device';
        btnLike.classList.remove('liked');
        return;
      }

      const track = state.track;
      playerTitle.textContent = track.name;
      playerArtist.textContent = track.artist;
      playerAlbum.textContent = track.album;

      if (track.albumArtUrl) {
        playerArt.src = track.albumArtUrl;
        playerArt.style.display = 'block';
        playerPlaceholder.style.display = 'none';
      } else {
        playerArt.style.display = 'none';
        playerPlaceholder.style.display = 'block';
      }

      if (state.isPlaying) {
        iconPlay.style.display = 'none';
        iconPause.style.display = 'block';
      } else {
        iconPlay.style.display = 'block';
        iconPause.style.display = 'none';
      }

      // Shuffle & Repeat
      btnShuffle.classList.toggle('active', !!state.shuffle);
      btnRepeat.classList.toggle('active', state.repeat !== 'off');
      btnRepeat.title = 'Repeat: ' + (state.repeat || 'off');

      // Like
      btnLike.classList.toggle('liked', !!track.isLiked);

      // Volume
      volumeSlider.value = state.volume;

      // Device
      if (state.device) {
        deviceName.textContent = state.device.name + (state.device.type ? ' (' + state.device.type + ')' : '');
      } else {
        deviceName.textContent = 'Active Device';
      }

      timeDuration.textContent = formatTime(state.durationMs);
      updateProgressDisplay();
    }

    function updateProgressDisplay() {
      if (!currentState || isDraggingProgress) return;
      let currentMs = currentState.progressMs || 0;
      if (currentState.isPlaying && currentState.timestamp > 0) {
        const delta = Date.now() - currentState.timestamp;
        currentMs = Math.min(currentState.durationMs || Infinity, currentMs + delta);
      }

      const percent = currentState.durationMs > 0 ? (currentMs / currentState.durationMs) * 100 : 0;
      progressBarFill.style.width = percent + '%';
      timeCurrent.textContent = formatTime(currentMs);
    }

    // Local progress ticker
    setInterval(updateProgressDisplay, 500);

    // Event Listeners for Player Controls
    btnSignIn.addEventListener('click', () => {
      const clientId = inputClientId ? inputClientId.value.trim() : '';
      vscode.postMessage({ type: 'signIn', clientId });
    });
    if (linkDevDash) {
      linkDevDash.addEventListener('click', (e) => {
        e.preventDefault();
        vscode.postMessage({ type: 'openDevDashboard' });
      });
    }
    linkDisconnect.addEventListener('click', () => vscode.postMessage({ type: 'signOut' }));

    btnPlayPause.addEventListener('click', () => vscode.postMessage({ type: 'playPause' }));
    btnPrev.addEventListener('click', () => vscode.postMessage({ type: 'previous' }));
    btnNext.addEventListener('click', () => vscode.postMessage({ type: 'next' }));
    btnShuffle.addEventListener('click', () => vscode.postMessage({ type: 'toggleShuffle' }));
    btnRepeat.addEventListener('click', () => vscode.postMessage({ type: 'toggleRepeat' }));
    btnLike.addEventListener('click', () => vscode.postMessage({ type: 'toggleLike' }));

    deviceBadge.addEventListener('click', () => {
      document.querySelector('.tab-btn[data-tab="devices"]').click();
    });

    // Scrubber click/seek
    progressBarContainer.addEventListener('click', (e) => {
      if (!currentState || !currentState.durationMs) return;
      const rect = progressBarContainer.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percent = Math.max(0, Math.min(1, clickX / rect.width));
      const targetMs = Math.floor(percent * currentState.durationMs);

      progressBarFill.style.width = (percent * 100) + '%';
      timeCurrent.textContent = formatTime(targetMs);

      vscode.postMessage({ type: 'seek', positionMs: targetMs });
    });

    // Volume
    volumeSlider.addEventListener('input', (e) => {
      const vol = parseInt(e.target.value, 10);
      vscode.postMessage({ type: 'setVolume', volumePercent: vol });
    });

    // Search input
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      if (searchDebounce) clearTimeout(searchDebounce);
      if (!query) {
        searchResults.innerHTML = '<div class="empty-msg">Type above to search Spotify</div>';
        return;
      }
      searchDebounce = setTimeout(() => {
        searchResults.innerHTML = '<div class="empty-msg">Searching…</div>';
        vscode.postMessage({ type: 'search', query });
      }, 350);
    });

    // Render Playlists
    function renderPlaylists(playlists) {
      if (!playlists || playlists.length === 0) {
        playlistsList.innerHTML = '<div class="empty-msg">No playlists found.</div>';
        return;
      }

      playlistsList.innerHTML = playlists.map(p => {
        const img = p.imageUrl ? '<img class="item-thumb" src="' + p.imageUrl + '" alt="" />' : '<div class="item-thumb"></div>';
        return '<div class="item-card" data-uri="' + p.uri + '" data-id="' + p.id + '">' +
          img +
          '<div class="item-details">' +
            '<div class="item-title">' + p.name + '</div>' +
            '<div class="item-subtitle">' + p.trackCount + ' tracks • by ' + p.owner + '</div>' +
          '</div>' +
          '<button class="item-action-btn" title="Play Playlist">' +
            '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>' +
          '</button>' +
        '</div>';
      }).join('');

      playlistsList.querySelectorAll('.item-card').forEach(card => {
        card.addEventListener('click', () => {
          const uri = card.dataset.uri;
          vscode.postMessage({ type: 'playContext', contextUri: uri });
        });
      });
    }

    // Render Search Results
    function renderSearchResults(results) {
      if (!results || (results.tracks.length === 0 && results.playlists.length === 0 && results.albums.length === 0)) {
        searchResults.innerHTML = '<div class="empty-msg">No results found.</div>';
        return;
      }

      let html = '';

      if (results.tracks && results.tracks.length > 0) {
        html += '<div class="section-title">Songs</div>';
        html += results.tracks.map(t => {
          const img = t.albumArtUrl ? '<img class="item-thumb" src="' + t.albumArtUrl + '" alt="" />' : '<div class="item-thumb"></div>';
          return '<div class="item-card track-result" data-uri="' + t.uri + '">' +
            img +
            '<div class="item-details">' +
              '<div class="item-title">' + t.name + '</div>' +
              '<div class="item-subtitle">' + t.artist + ' • ' + formatTime(t.durationMs) + '</div>' +
            '</div>' +
            '<button class="item-action-btn" title="Play Song">' +
              '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>' +
            '</button>' +
          '</div>';
        }).join('');
      }

      if (results.playlists && results.playlists.length > 0) {
        html += '<div class="section-title">Playlists</div>';
        html += results.playlists.map(p => {
          const img = p.imageUrl ? '<img class="item-thumb" src="' + p.imageUrl + '" alt="" />' : '<div class="item-thumb"></div>';
          return '<div class="item-card playlist-result" data-uri="' + p.uri + '">' +
            img +
            '<div class="item-details">' +
              '<div class="item-title">' + p.name + '</div>' +
              '<div class="item-subtitle">Playlist • ' + p.trackCount + ' tracks</div>' +
            '</div>' +
            '<button class="item-action-btn" title="Play Playlist">' +
              '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>' +
            '</button>' +
          '</div>';
        }).join('');
      }

      if (results.albums && results.albums.length > 0) {
        html += '<div class="section-title">Albums</div>';
        html += results.albums.map(a => {
          const img = a.imageUrl ? '<img class="item-thumb" src="' + a.imageUrl + '" alt="" />' : '<div class="item-thumb"></div>';
          return '<div class="item-card album-result" data-uri="' + a.uri + '">' +
            img +
            '<div class="item-details">' +
              '<div class="item-title">' + a.name + '</div>' +
              '<div class="item-subtitle">' + a.artist + ' • ' + a.trackCount + ' tracks</div>' +
            '</div>' +
            '<button class="item-action-btn" title="Play Album">' +
              '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>' +
            '</button>' +
          '</div>';
        }).join('');
      }

      searchResults.innerHTML = html;

      searchResults.querySelectorAll('.track-result').forEach(el => {
        el.addEventListener('click', () => {
          vscode.postMessage({ type: 'playTrack', uri: el.dataset.uri });
        });
      });

      searchResults.querySelectorAll('.playlist-result, .album-result').forEach(el => {
        el.addEventListener('click', () => {
          vscode.postMessage({ type: 'playContext', contextUri: el.dataset.uri });
        });
      });
    }

    // Render Devices
    function renderDevices(devices) {
      if (!devices || devices.length === 0) {
        devicesList.innerHTML = '<div class="empty-msg">No Spotify devices found. Open Spotify on your phone, laptop, or desktop.</div>';
        return;
      }

      devicesList.innerHTML = devices.map(d => {
        const activeClass = d.isActive ? 'style="border-color: var(--null-accent);"' : '';
        const badge = d.isActive ? '<span style="color: var(--null-accent); font-size: 10px; font-weight: bold;">ACTIVE</span>' : '';
        return '<div class="item-card device-item" data-id="' + d.id + '" ' + activeClass + '>' +
          '<div class="item-details">' +
            '<div class="item-title">' + d.name + ' ' + (d.type ? '[' + d.type + ']' : '') + '</div>' +
            '<div class="item-subtitle">Volume: ' + d.volumePercent + '%</div>' +
          '</div>' +
          badge +
        '</div>';
      }).join('');

      devicesList.querySelectorAll('.device-item').forEach(el => {
        el.addEventListener('click', () => {
          vscode.postMessage({ type: 'transferDevice', deviceId: el.dataset.id });
        });
      });
    }

    // Render Local Library
    function renderLocalLibrary(tracks, folders) {
      if (!folders || folders.length === 0) {
        localFoldersList.innerHTML = '';
        localTracksList.innerHTML = '';
        localTracksHeader.style.display = 'none';
        localEmptyMsg.style.display = 'block';
        return;
      }

      localEmptyMsg.style.display = 'none';

      // Render folders
      localFoldersList.innerHTML = folders.map(f => {
        const folderName = f.split('/').pop() || f.split('\\\\').pop() || f;
        return '<div class="item-card" data-folder-uri="' + f + '" style="gap: 8px;">' +
          '<svg viewBox="0 0 16 16" width="20" height="20" fill="var(--null-accent)" style="flex-shrink:0;"><path d="M.54 3.87.5 3a2 2 0 0 1 2-2h3.19a2 2 0 0 1 1.45.63l.41.44H14a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-1.49l.54-7.13zM2 14h12V5H9.19l-.61-.65a.5.5 0 0 0-.36-.15H2.5a.5.5 0 0 0-.5.5L2 14z"/></svg>' +
          '<div class="item-details"><div class="item-title">' + folderName + '</div>' +
          '<div class="item-subtitle">' + (tracks.filter(t => t.album === f).length) + ' tracks</div></div>' +
          '<button class="item-action-btn folder-play-btn" title="Play Folder" data-folder-uri="' + f + '" style="opacity:1;">' +
            '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>' +
          '</button>' +
          '<button class="item-action-btn folder-remove-btn" title="Remove Folder" data-folder-uri="' + f + '" style="opacity:1; color: var(--null-danger);">' +
            '<svg viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>' +
          '</button>' +
        '</div>';
      }).join('');

      // Folder play buttons
      localFoldersList.querySelectorAll('.folder-play-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({ type: 'localPlayFolder', folderUri: btn.dataset.folderUri });
        });
      });

      // Folder remove buttons
      localFoldersList.querySelectorAll('.folder-remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({ type: 'localRemoveFolder', folderUri: btn.dataset.folderUri });
        });
      });

      // Render tracks
      if (tracks && tracks.length > 0) {
        localTracksHeader.style.display = 'block';
        localTracksList.innerHTML = tracks.map((t, idx) => {
          return '<div class="item-card local-track-card" data-track-uri="' + t.uri + '">' +
            '<svg viewBox="0 0 16 16" width="16" height="16" fill="var(--null-text-muted)" style="flex-shrink:0;"><path d="M12 1v8.55A3.5 3.5 0 1 0 13 12V3h2V1h-3zM5.5 14A2.5 2.5 0 1 1 8 11.5 2.5 2.5 0 0 1 5.5 14z"/></svg>' +
            '<div class="item-details">' +
              '<div class="item-title">' + t.name + '</div>' +
              '<div class="item-subtitle">' + t.artist + '</div>' +
            '</div>' +
            '<button class="item-action-btn" title="Play" style="opacity:1;">' +
              '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>' +
            '</button>' +
          '</div>';
        }).join('');

        localTracksList.querySelectorAll('.local-track-card').forEach(card => {
          card.addEventListener('click', () => {
            vscode.postMessage({ type: 'localPlayTrack', trackUri: card.dataset.trackUri });
          });
        });
      } else {
        localTracksHeader.style.display = 'none';
        localTracksList.innerHTML = '';
      }
    }

    // ── Local Audio element handlers ─────────────────────────────────────────
    if (audioPlayer) {
      audioPlayer.addEventListener('loadedmetadata', () => {
        const durationMs = Math.round(audioPlayer.duration * 1000);
        vscode.postMessage({ type: 'localAudioDuration', durationMs });
      });

      audioPlayer.addEventListener('ended', () => {
        vscode.postMessage({ type: 'localAudioEnded' });
      });
    }

    // ── Add folder button ────────────────────────────────────────────────────
    if (btnAddFolder) {
      btnAddFolder.addEventListener('click', () => {
        vscode.postMessage({ type: 'localOpenFolder' });
      });
    }

    // ── Service switcher dropdown ─────────────────────────────────────────────
    const selectProvider = document.getElementById('select-provider');
    if (selectProvider) {
      selectProvider.addEventListener('change', () => {
        const providerId = selectProvider.value;
        vscode.postMessage({ type: 'switchProvider', providerId });
      });
    }

    const btnSwitchLofi = document.getElementById('btn-switch-lofi');
    if (btnSwitchLofi) {
      btnSwitchLofi.addEventListener('click', () => {
        if (selectProvider) selectProvider.value = 'lofi';
        vscode.postMessage({ type: 'switchProvider', providerId: 'lofi' });
      });
    }

    // Handle messages from Extension Host
    window.addEventListener('message', event => {
      const msg = event.data;
      if (!msg) return;

      switch (msg.type) {
        case 'authUpdate':
          updateAuthState(msg.isAuthenticated, msg.user, msg.clientId, msg.providerId);
          break;
        case 'stateUpdate':
          renderPlaybackState(msg.state);
          break;
        case 'playlistsUpdate':
          renderPlaylists(msg.playlists);
          break;
        case 'searchResults':
          renderSearchResults(msg.results);
          break;
        case 'devicesUpdate':
          renderDevices(msg.devices);
          break;
        case 'localLibraryUpdate':
          renderLocalLibrary(msg.tracks, msg.folders);
          break;

        // ── Audio adapter commands from extension host → <audio> element ──
        case 'localPlay':
          if (audioPlayer && msg.uri) {
            audioPlayer.src = msg.uri;
            audioPlayer.load();
            audioPlayer.play().catch(err => console.error('Audio play error:', err));
          }
          break;
        case 'localPause':
          if (audioPlayer) audioPlayer.pause();
          break;
        case 'localResume':
          if (audioPlayer) audioPlayer.play().catch(() => {});
          break;
        case 'localSeek':
          if (audioPlayer && typeof msg.positionMs === 'number') {
            audioPlayer.currentTime = msg.positionMs / 1000;
          }
          break;
        case 'localVolume':
          if (audioPlayer && typeof msg.volumePercent === 'number') {
            audioPlayer.volume = msg.volumePercent / 100;
          }
          break;
      }
    });

    // Notify ready
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
//# sourceMappingURL=musicHtml.js.map