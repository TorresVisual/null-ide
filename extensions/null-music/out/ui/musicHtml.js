'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMusicWebviewHtml = getMusicWebviewHtml;
function getMusicWebviewHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: http: vscode-resource: vscode-webview-resource:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; media-src vscode-resource: vscode-webview-resource: https: blob: http:;">
  <title>Null Music</title>
  <style>
    :root {
      --bg-canvas: #181818;
      --bg-surface: #1F1F1F;
      --bg-card: #202020;
      --bg-control: #2B2B2B;
      --bg-control-hover: #353535;
      --border-divider: #2B2B2B;
      --border-control: #3C3C3C;
      --text-primary: #CCCCCC;
      --text-secondary: #9D9D9D;
      --text-disabled: #6E7681;
      --accent: #0078D4;
      --accent-hover: #026EC1;
      --accent-tint: rgba(0, 120, 212, 0.12);
      --danger: #F85149;
      --danger-hover: #da3633;
      --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      --font-mono: 'Geist Mono', 'JetBrains Mono', 'Cascadia Code', monospace;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      user-select: none;
    }

    body {
      background-color: var(--bg-canvas);
      color: var(--text-primary);
      font-family: var(--font-ui);
      font-size: 12px;
      line-height: 1.4;
      padding: 10px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow-x: hidden;
      overflow-y: auto;
    }

    /* 6px Scrollbars per Null IDE Design System */
    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: var(--border-divider);
      border-radius: 3px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: var(--border-control);
    }

    /* Header */
    .header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 8px;
      margin-bottom: 8px;
      border-bottom: 1px solid var(--border-divider);
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--text-secondary);
    }

    .header-mark {
      color: var(--text-primary);
      font-weight: 700;
    }

    .track-badge {
      font-family: var(--font-mono);
      font-size: 10px;
      background: var(--bg-surface);
      border: 1px solid var(--border-divider);
      color: var(--text-secondary);
      padding: 1px 5px;
      border-radius: 4px;
    }

    .btn-header {
      background: var(--bg-control);
      border: 1px solid var(--border-control);
      color: var(--text-primary);
      font-family: var(--font-ui);
      font-size: 11px;
      font-weight: 500;
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: background 0.15s, border-color 0.15s;
    }

    .btn-header:hover {
      background: var(--bg-control-hover);
      border-color: var(--accent);
    }

    /* Search Bar */
    .search-wrapper {
      position: relative;
      margin-bottom: 8px;
    }

    .search-input {
      width: 100%;
      background: var(--bg-surface);
      border: 1px solid var(--border-divider);
      border-radius: 4px;
      color: var(--text-primary);
      font-family: var(--font-ui);
      font-size: 12px;
      padding: 5px 24px 5px 26px;
      outline: none;
      transition: border-color 0.15s;
    }

    .search-input:focus {
      border-color: var(--accent);
    }

    .search-input::placeholder {
      color: var(--text-disabled);
    }

    .search-icon {
      position: absolute;
      left: 7px;
      top: 50%;
      transform: translateY(-50%);
      width: 13px;
      height: 13px;
      fill: var(--text-disabled);
      pointer-events: none;
    }

    .search-clear {
      position: absolute;
      right: 6px;
      top: 50%;
      transform: translateY(-50%);
      background: transparent;
      border: none;
      color: var(--text-disabled);
      font-size: 13px;
      cursor: pointer;
      display: none;
      padding: 0 4px;
    }

    .search-clear:hover {
      color: var(--text-primary);
    }

    /* Now Playing Hero */
    .player-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-divider);
      border-radius: 6px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 10px;
    }

    .player-track-row {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .player-badge {
      width: 32px;
      height: 32px;
      background: var(--bg-canvas);
      border: 1px solid var(--border-divider);
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      color: var(--accent);
    }

    .player-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .player-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .player-artist {
      font-size: 11px;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Scrubber */
    .scrubber-section {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .scrubber-bar-container {
      width: 100%;
      height: 12px;
      display: flex;
      align-items: center;
      cursor: pointer;
    }

    .scrubber-track {
      position: relative;
      width: 100%;
      height: 3px;
      background: var(--border-divider);
      border-radius: 2px;
      overflow: hidden;
      transition: height 0.15s ease;
    }

    .scrubber-bar-container:hover .scrubber-track {
      height: 5px;
    }

    .scrubber-fill {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 0%;
      background: var(--accent);
      border-radius: 2px;
      transition: width 0.1s linear;
    }

    .scrubber-times {
      display: flex;
      justify-content: space-between;
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-secondary);
    }

    /* Controls */
    .controls-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .ctrl-btn {
      background: transparent;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 4px;
      transition: color 0.15s, background 0.15s;
    }

    .ctrl-btn svg {
      width: 14px;
      height: 14px;
      fill: currentColor;
    }

    .ctrl-btn:hover {
      color: var(--text-primary);
      background: var(--bg-control);
    }

    .ctrl-btn.active {
      color: var(--accent);
    }

    .ctrl-btn-play {
      background: var(--accent);
      color: #ffffff;
      width: 30px;
      height: 30px;
      border-radius: 50%;
    }

    .ctrl-btn-play svg {
      width: 14px;
      height: 14px;
      fill: #ffffff;
    }

    .ctrl-btn-play:hover {
      background: var(--accent-hover);
      color: #ffffff;
    }

    .ctrl-btn.liked {
      color: var(--accent);
    }

    .ctrl-btn.liked svg {
      fill: var(--accent);
    }

    /* Volume */
    .volume-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 4px;
    }

    .volume-icon {
      width: 12px;
      height: 12px;
      fill: var(--text-secondary);
      flex-shrink: 0;
    }

    .volume-slider {
      flex: 1;
      -webkit-appearance: none;
      height: 3px;
      background: var(--border-divider);
      border-radius: 2px;
      outline: none;
      cursor: pointer;
    }

    .volume-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 10px;
      height: 10px;
      background: var(--accent);
      border-radius: 50%;
      cursor: pointer;
    }

    .volume-text {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-secondary);
      width: 28px;
      text-align: right;
    }

    /* Tabs Segment */
    .tabs-bar {
      display: flex;
      border-bottom: 1px solid var(--border-divider);
      margin-bottom: 8px;
    }

    .tab-item {
      padding: 6px 12px;
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--text-secondary);
      font-family: var(--font-ui);
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      transition: color 0.15s, border-color 0.15s;
    }

    .tab-item:hover {
      color: var(--text-primary);
    }

    .tab-item.active {
      color: var(--text-primary);
      border-bottom-color: var(--accent);
      font-weight: 600;
    }

    .tab-count {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-disabled);
    }

    .tab-pane {
      display: none;
      flex-direction: column;
      gap: 2px;
      flex: 1;
    }

    .tab-pane.active {
      display: flex;
    }

    /* List Items */
    .track-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 8px;
      border-radius: 4px;
      cursor: pointer;
      border-left: 2px solid transparent;
      transition: background 0.1s, border-color 0.1s;
    }

    .track-row:hover {
      background: rgba(255, 255, 255, 0.04);
    }

    .track-row.active {
      background: var(--accent-tint);
      border-left-color: var(--accent);
    }

    .track-idx {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-disabled);
      width: 18px;
      text-align: right;
      flex-shrink: 0;
    }

    .track-row.active .track-idx {
      color: var(--accent);
    }

    .track-details {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .track-name {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .track-sub {
      font-size: 11px;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .track-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .track-time {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-secondary);
    }

    .track-heart-btn {
      background: transparent;
      border: none;
      color: var(--text-disabled);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2px;
      border-radius: 3px;
    }

    .track-heart-btn:hover {
      color: var(--text-primary);
    }

    .track-heart-btn.liked {
      color: var(--accent);
    }

    .track-heart-btn svg {
      width: 12px;
      height: 12px;
      fill: currentColor;
    }

    /* Folders Pane */
    .folder-card {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      background: var(--bg-surface);
      border: 1px solid var(--border-divider);
      border-radius: 4px;
      margin-bottom: 4px;
    }

    .folder-icon {
      width: 16px;
      height: 16px;
      fill: var(--accent);
      flex-shrink: 0;
    }

    .folder-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .folder-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .folder-path {
      font-size: 10px;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .folder-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .folder-btn {
      background: transparent;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
      border-radius: 3px;
    }

    .folder-btn:hover {
      color: var(--text-primary);
      background: var(--bg-control);
    }

    .folder-btn.remove-btn:hover {
      color: var(--danger);
    }

    .folder-btn svg {
      width: 13px;
      height: 13px;
      fill: currentColor;
    }

    /* Empty States */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 32px 16px;
      gap: 8px;
      color: var(--text-secondary);
    }

    .empty-icon {
      font-size: 24px;
      color: var(--text-disabled);
    }

    .empty-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .empty-desc {
      font-size: 11px;
      color: var(--text-secondary);
      max-width: 220px;
      line-height: 1.4;
    }
  </style>
</head>
<body>

  <!-- Top Header -->
  <div class="header-bar">
    <div class="header-title">
      <span class="header-mark">∅</span>
      <span>Music</span>
      <span id="badge-total-tracks" class="track-badge">0</span>
    </div>
    <button id="btn-add-folder" class="btn-header" title="Add music folder">
      <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
        <path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/>
      </svg>
      Add Folder
    </button>
  </div>

  <!-- Search / Filter -->
  <div class="search-wrapper">
    <svg class="search-icon" viewBox="0 0 16 16">
      <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
    </svg>
    <input id="search-input" class="search-input" type="text" placeholder="Filter tracks or artists…" autocomplete="off" spellcheck="false" />
    <button id="btn-search-clear" class="search-clear" title="Clear">×</button>
  </div>

  <!-- Player Card -->
  <div class="player-card">
    <div class="player-track-row">
      <div class="player-badge">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
          <path d="M12 1v8.55A3.5 3.5 0 1 0 13 12V3h2V1h-3zM5.5 14A2.5 2.5 0 1 1 8 11.5 2.5 2.5 0 0 1 5.5 14zm6.5-2a2.5 2.5 0 1 1 2.5-2.5 2.5 2.5 0 0 1-2.5 2.5z"/>
        </svg>
      </div>
      <div class="player-info">
        <div id="player-title" class="player-title">No Track Playing</div>
        <div id="player-artist" class="player-artist">Add a folder or pick a track</div>
      </div>
      <button id="btn-like" class="ctrl-btn" title="Favorite Track">
        <svg viewBox="0 0 16 16">
          <path d="M8 14s-6-3.8-6-8a4 4 0 0 1 6.8-2.8L8 4.3l.2-.1A4 4 0 0 1 15 6c0 4.2-6 8-6 8z"/>
        </svg>
      </button>
    </div>

    <!-- Scrubber -->
    <div class="scrubber-section">
      <div id="progress-bar-container" class="scrubber-bar-container">
        <div class="scrubber-track">
          <div id="progress-bar-fill" class="scrubber-fill"></div>
        </div>
      </div>
      <div class="scrubber-times">
        <span id="time-current">0:00</span>
        <span id="time-duration">0:00</span>
      </div>
    </div>

    <!-- Playback Controls -->
    <div class="controls-row">
      <button id="btn-shuffle" class="ctrl-btn" title="Toggle Shuffle">
        <svg viewBox="0 0 16 16"><path d="M12.5 1.5l3 3-3 3V5H11c-1.3 0-2.4.6-3.2 1.6l-.6.7c-1 1.2-2.3 2-3.8 2H1v-2h2.4c.8 0 1.6-.4 2.2-1.1l.6-.7C7.3 4.2 8.8 3.3 10.5 3.3H12.5V1.5zM1 9.7h2.4c.5 0 1 .1 1.4.3l-.7 1.8c-.2-.1-.5-.1-.7-.1H1V9.7zm9.5-3.4c.5 0 1 .1 1.5.2V5l3 3-3 3v-1.5h-2c-1.3 0-2.4-.6-3.2-1.6l.6-.7c.8 1 1.9 1.6 3.1 1.6h1.5z"/></svg>
      </button>

      <button id="btn-prev" class="ctrl-btn" title="Previous Track">
        <svg viewBox="0 0 16 16"><path d="M3.5 2v12h1.5V8.8l7.5 5.2V2L5 7.2V2H3.5z"/></svg>
      </button>

      <button id="btn-play-pause" class="ctrl-btn ctrl-btn-play" title="Play / Pause">
        <svg id="icon-play" viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>
        <svg id="icon-pause" viewBox="0 0 16 16" style="display: none;"><path d="M3.5 2.5h3v11h-3zm6 0h3v11h-3z"/></svg>
      </button>

      <button id="btn-next" class="ctrl-btn" title="Next Track">
        <svg viewBox="0 0 16 16"><path d="M12.5 2v12H11V8.8L3.5 14V2L11 7.2V2h1.5z"/></svg>
      </button>

      <button id="btn-repeat" class="ctrl-btn" title="Toggle Repeat Mode">
        <svg viewBox="0 0 16 16"><path d="M11 1v2H4.5C2.6 3 1 4.6 1 6.5S2.6 10 4.5 10H5V8.5h-.5C3.4 8.5 2.5 7.6 2.5 6.5S3.4 4.5 4.5 4.5H11V6.5l3.5-2.75L11 1zm.5 5H11v1.5h.5c1.1 0 2 .9 2 2s-.9 2-2 2H5V9.5L1.5 12.25 5 15v-2h6.5c1.9 0 3.5-1.6 3.5-3.5S13.4 6 11.5 6z"/></svg>
      </button>
    </div>

    <!-- Volume -->
    <div class="volume-row">
      <svg class="volume-icon" viewBox="0 0 16 16">
        <path d="M8.5 2.2L4.3 6H1.5C1.2 6 1 6.2 1 6.5v3c0 .3.2.5.5.5h2.8l4.2 3.8c.4.3.9 0 .9-.5v-10.6c0-.5-.5-.8-.9-.5zM11.5 8c0-1.3-.7-2.4-1.8-3v6c1.1-.6 1.8-1.7 1.8-3z"/>
      </svg>
      <input id="volume-slider" class="volume-slider" type="range" min="0" max="100" value="80" />
      <span id="volume-text" class="volume-text">80%</span>
    </div>
  </div>

  <!-- Navigation Tabs -->
  <div class="tabs-bar">
    <button class="tab-item active" data-tab="tracks">
      Tracks <span id="tab-count-tracks" class="tab-count">0</span>
    </button>
    <button class="tab-item" data-tab="folders">
      Folders <span id="tab-count-folders" class="tab-count">0</span>
    </button>
    <button class="tab-item" data-tab="favorites">
      Favorites <span id="tab-count-favorites" class="tab-count">0</span>
    </button>
  </div>

  <!-- Tracks Pane -->
  <div id="pane-tracks" class="tab-pane active">
    <div id="tracks-list"></div>
    <div id="empty-tracks" class="empty-state">
      <div class="empty-icon">∅</div>
      <div class="empty-title">No Tracks Found</div>
      <div class="empty-desc">Click "Add Folder" to add audio files (MP3, FLAC, WAV, OGG, AAC).</div>
    </div>
  </div>

  <!-- Folders Pane -->
  <div id="pane-folders" class="tab-pane">
    <div id="folders-list"></div>
    <div id="empty-folders" class="empty-state">
      <div class="empty-icon">📁</div>
      <div class="empty-title">No Folders Added</div>
      <div class="empty-desc">Add a folder from your disk to scan music.</div>
    </div>
  </div>

  <!-- Favorites Pane -->
  <div id="pane-favorites" class="tab-pane">
    <div id="favorites-list"></div>
    <div id="empty-favorites" class="empty-state">
      <div class="empty-icon">♡</div>
      <div class="empty-title">No Favorites Yet</div>
      <div class="empty-desc">Click the heart button on any track to save it here.</div>
    </div>
  </div>

  <audio id="audio-player" preload="auto" style="display: none;"></audio>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    let allTracks = [];
    let allFolders = [];
    let currentState = null;
    let activeTab = 'tracks';
    let searchQuery = '';

    // Elements
    const audioPlayer = document.getElementById('audio-player');
    const badgeTotalTracks = document.getElementById('badge-total-tracks');
    const btnAddFolder = document.getElementById('btn-add-folder');
    const searchInput = document.getElementById('search-input');
    const btnSearchClear = document.getElementById('btn-search-clear');

    const playerTitle = document.getElementById('player-title');
    const playerArtist = document.getElementById('player-artist');
    const btnLike = document.getElementById('btn-like');
    const progressBarContainer = document.getElementById('progress-bar-container');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const timeCurrent = document.getElementById('time-current');
    const timeDuration = document.getElementById('time-duration');

    const btnShuffle = document.getElementById('btn-shuffle');
    const btnPrev = document.getElementById('btn-prev');
    const btnPlayPause = document.getElementById('btn-play-pause');
    const iconPlay = document.getElementById('icon-play');
    const iconPause = document.getElementById('icon-pause');
    const btnNext = document.getElementById('btn-next');
    const btnRepeat = document.getElementById('btn-repeat');
    const volumeSlider = document.getElementById('volume-slider');
    const volumeText = document.getElementById('volume-text');

    const tabCountTracks = document.getElementById('tab-count-tracks');
    const tabCountFolders = document.getElementById('tab-count-folders');
    const tabCountFavorites = document.getElementById('tab-count-favorites');

    const paneTracks = document.getElementById('pane-tracks');
    const paneFolders = document.getElementById('pane-folders');
    const paneFavorites = document.getElementById('pane-favorites');

    const tracksList = document.getElementById('tracks-list');
    const foldersList = document.getElementById('folders-list');
    const favoritesList = document.getElementById('favorites-list');

    const emptyTracks = document.getElementById('empty-tracks');
    const emptyFolders = document.getElementById('empty-folders');
    const emptyFavorites = document.getElementById('empty-favorites');

    // Formatting helper
    function formatTime(ms) {
      if (!ms || ms < 0 || isNaN(ms)) return '0:00';
      const totalSeconds = Math.floor(ms / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
    }

    // Tab Switching
    document.querySelectorAll('.tab-item').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeTab = btn.dataset.tab;

        [paneTracks, paneFolders, paneFavorites].forEach(p => p.classList.remove('active'));
        if (activeTab === 'tracks') paneTracks.classList.add('active');
        else if (activeTab === 'folders') paneFolders.classList.add('active');
        else if (activeTab === 'favorites') paneFavorites.classList.add('active');

        renderViews();
      });
    });

    // Search input
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      btnSearchClear.style.display = searchQuery ? 'block' : 'none';
      renderViews();
    });

    btnSearchClear.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      btnSearchClear.style.display = 'none';
      renderViews();
    });

    // Add folder
    btnAddFolder.addEventListener('click', () => {
      vscode.postMessage({ type: 'localOpenFolder' });
    });

    // Controls
    btnPlayPause.addEventListener('click', () => vscode.postMessage({ type: 'playPause' }));
    btnPrev.addEventListener('click', () => vscode.postMessage({ type: 'previous' }));
    btnNext.addEventListener('click', () => vscode.postMessage({ type: 'next' }));
    btnShuffle.addEventListener('click', () => vscode.postMessage({ type: 'toggleShuffle' }));
    btnRepeat.addEventListener('click', () => vscode.postMessage({ type: 'toggleRepeat' }));
    btnLike.addEventListener('click', () => vscode.postMessage({ type: 'toggleLike' }));

    // Volume
    volumeSlider.addEventListener('input', (e) => {
      const vol = parseInt(e.target.value, 10);
      volumeText.textContent = vol + '%';
      vscode.postMessage({ type: 'setVolume', volumePercent: vol });
    });

    // Scrubber seek
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

    // Audio element handlers
    audioPlayer.addEventListener('loadedmetadata', () => {
      const durationMs = Math.round(audioPlayer.duration * 1000);
      timeDuration.textContent = formatTime(durationMs);
      vscode.postMessage({ type: 'localAudioDuration', durationMs });
    });

    audioPlayer.addEventListener('ended', () => {
      vscode.postMessage({ type: 'localAudioEnded' });
    });

    // Progress tick
    function updateProgress() {
      if (!currentState || !currentState.isPlaying || currentState.timestamp <= 0) return;
      const delta = Date.now() - currentState.timestamp;
      const cur = Math.min(currentState.durationMs || Infinity, (currentState.progressMs || 0) + delta);
      const pct = currentState.durationMs > 0 ? (cur / currentState.durationMs) * 100 : 0;
      progressBarFill.style.width = pct + '%';
      timeCurrent.textContent = formatTime(cur);
    }
    setInterval(updateProgress, 400);

    // Playback state rendering
    function renderPlaybackState(state) {
      currentState = state;
      if (!state || !state.track) {
        playerTitle.textContent = 'No Track Playing';
        playerArtist.textContent = allTracks.length > 0 ? 'Select a track from the library' : 'Click "Add Folder" to start';
        iconPlay.style.display = 'block';
        iconPause.style.display = 'none';
        progressBarFill.style.width = '0%';
        timeCurrent.textContent = '0:00';
        timeDuration.textContent = '0:00';
        btnLike.classList.remove('liked');
        updateActiveTrackRow(null);
        return;
      }

      const t = state.track;
      playerTitle.textContent = t.name;
      playerArtist.textContent = t.artist;
      btnLike.classList.toggle('liked', !!t.isLiked);

      if (state.isPlaying) {
        iconPlay.style.display = 'none';
        iconPause.style.display = 'block';
      } else {
        iconPlay.style.display = 'block';
        iconPause.style.display = 'none';
      }

      btnShuffle.classList.toggle('active', !!state.shuffle);
      btnRepeat.classList.toggle('active', state.repeat !== 'off');
      btnRepeat.title = 'Repeat: ' + (state.repeat || 'off');

      if (typeof state.volume === 'number') {
        volumeSlider.value = state.volume;
        volumeText.textContent = state.volume + '%';
      }

      timeDuration.textContent = formatTime(state.durationMs);
      const pct = state.durationMs > 0 ? ((state.progressMs || 0) / state.durationMs) * 100 : 0;
      progressBarFill.style.width = pct + '%';
      timeCurrent.textContent = formatTime(state.progressMs || 0);

      updateActiveTrackRow(t.uri);
    }

    function updateActiveTrackRow(activeUri) {
      document.querySelectorAll('.track-row').forEach(row => {
        row.classList.toggle('active', row.dataset.trackUri === activeUri);
      });
    }

    // Views rendering
    function renderViews() {
      // Filter tracks
      let filtered = allTracks;
      if (searchQuery) {
        filtered = allTracks.filter(t =>
          t.name.toLowerCase().includes(searchQuery) ||
          t.artist.toLowerCase().includes(searchQuery)
        );
      }

      const likedTracks = allTracks.filter(t => !!t.isLiked);

      badgeTotalTracks.textContent = allTracks.length + ' tracks';
      tabCountTracks.textContent = allTracks.length;
      tabCountFolders.textContent = allFolders.length;
      tabCountFavorites.textContent = likedTracks.length;

      // 1. Tracks Pane
      if (filtered.length === 0) {
        tracksList.innerHTML = '';
        emptyTracks.style.display = 'flex';
        if (searchQuery) {
          emptyTracks.querySelector('.empty-title').textContent = 'No Matches';
          emptyTracks.querySelector('.empty-desc').textContent = 'No tracks match "' + searchQuery + '".';
        } else {
          emptyTracks.querySelector('.empty-title').textContent = 'No Tracks Found';
          emptyTracks.querySelector('.empty-desc').textContent = 'Click "Add Folder" to add audio files.';
        }
      } else {
        emptyTracks.style.display = 'none';
        tracksList.innerHTML = filtered.map((t, idx) => {
          const isAct = currentState?.track?.uri === t.uri;
          const likedClass = t.isLiked ? 'liked' : '';
          return '<div class="track-row ' + (isAct ? 'active' : '') + '" data-track-uri="' + t.uri + '">' +
            '<div class="track-idx">' + (idx + 1) + '</div>' +
            '<div class="track-details">' +
              '<div class="track-name">' + escapeHtml(t.name) + '</div>' +
              '<div class="track-sub">' + escapeHtml(t.artist) + '</div>' +
            '</div>' +
            '<div class="track-meta">' +
              (t.durationMs > 0 ? '<span class="track-time">' + formatTime(t.durationMs) + '</span>' : '') +
              '<button class="track-heart-btn ' + likedClass + '" data-track-id="' + t.id + '" title="Favorite">' +
                '<svg viewBox="0 0 16 16"><path d="M8 14s-6-3.8-6-8a4 4 0 0 1 6.8-2.8L8 4.3l.2-.1A4 4 0 0 1 15 6c0 4.2-6 8-6 8z"/></svg>' +
              '</button>' +
            '</div>' +
          '</div>';
        }).join('');

        tracksList.querySelectorAll('.track-row').forEach(row => {
          row.addEventListener('click', (e) => {
            if (e.target.closest('.track-heart-btn')) return;
            vscode.postMessage({ type: 'localPlayTrack', trackUri: row.dataset.trackUri });
          });
        });

        tracksList.querySelectorAll('.track-heart-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const trackId = btn.dataset.trackId;
            const trk = allTracks.find(t => t.id === trackId);
            if (trk) {
              trk.isLiked = !trk.isLiked;
              btn.classList.toggle('liked', trk.isLiked);
              tabCountFavorites.textContent = allTracks.filter(t => !!t.isLiked).length;
              if (currentState?.track?.id === trackId) {
                currentState.track.isLiked = trk.isLiked;
                btnLike.classList.toggle('liked', trk.isLiked);
              }
              vscode.postMessage({ type: 'toggleTrackLike', trackId });
            }
          });
        });
      }

      // 2. Folders Pane
      if (allFolders.length === 0) {
        foldersList.innerHTML = '';
        emptyFolders.style.display = 'flex';
      } else {
        emptyFolders.style.display = 'none';
        foldersList.innerHTML = allFolders.map(f => {
          const fName = f.split('/').pop() || f.split('\\\\').pop() || f;
          const count = allTracks.filter(t => t.album === f).length;
          return '<div class="folder-card" data-folder-uri="' + f + '">' +
            '<svg class="folder-icon" viewBox="0 0 16 16"><path d="M.54 3.87.5 3a2 2 0 0 1 2-2h3.19a2 2 0 0 1 1.45.63l.41.44H14a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-1.49l.54-7.13zM2 14h12V5H9.19l-.61-.65a.5.5 0 0 0-.36-.15H2.5a.5.5 0 0 0-.5.5L2 14z"/></svg>' +
            '<div class="folder-info">' +
              '<div class="folder-name">' + escapeHtml(fName) + ' <span class="tab-count">(' + count + ')</span></div>' +
              '<div class="folder-path">' + escapeHtml(f) + '</div>' +
            '</div>' +
            '<div class="folder-actions">' +
              '<button class="folder-btn folder-play-btn" data-folder-uri="' + f + '" title="Play Folder">' +
                '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>' +
              '</button>' +
              '<button class="folder-btn remove-btn folder-remove-btn" data-folder-uri="' + f + '" title="Remove Folder">' +
                '<svg viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>' +
              '</button>' +
            '</div>' +
          '</div>';
        }).join('');

        foldersList.querySelectorAll('.folder-play-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'localPlayFolder', folderUri: btn.dataset.folderUri });
          });
        });

        foldersList.querySelectorAll('.folder-remove-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'localRemoveFolder', folderUri: btn.dataset.folderUri });
          });
        });
      }

      // 3. Favorites Pane
      const favList = searchQuery
        ? likedTracks.filter(t => t.name.toLowerCase().includes(searchQuery) || t.artist.toLowerCase().includes(searchQuery))
        : likedTracks;

      if (favList.length === 0) {
        favoritesList.innerHTML = '';
        emptyFavorites.style.display = 'flex';
      } else {
        emptyFavorites.style.display = 'none';
        favoritesList.innerHTML = favList.map((t, idx) => {
          const isAct = currentState?.track?.uri === t.uri;
          return '<div class="track-row ' + (isAct ? 'active' : '') + '" data-track-uri="' + t.uri + '">' +
            '<div class="track-idx">' + (idx + 1) + '</div>' +
            '<div class="track-details">' +
              '<div class="track-name">' + escapeHtml(t.name) + '</div>' +
              '<div class="track-sub">' + escapeHtml(t.artist) + '</div>' +
            '</div>' +
            '<div class="track-meta">' +
              (t.durationMs > 0 ? '<span class="track-time">' + formatTime(t.durationMs) + '</span>' : '') +
              '<button class="track-heart-btn liked" data-track-id="' + t.id + '" title="Remove from Favorites">' +
                '<svg viewBox="0 0 16 16"><path d="M8 14s-6-3.8-6-8a4 4 0 0 1 6.8-2.8L8 4.3l.2-.1A4 4 0 0 1 15 6c0 4.2-6 8-6 8z"/></svg>' +
              '</button>' +
            '</div>' +
          '</div>';
        }).join('');

        favoritesList.querySelectorAll('.track-row').forEach(row => {
          row.addEventListener('click', (e) => {
            if (e.target.closest('.track-heart-btn')) return;
            vscode.postMessage({ type: 'localPlayTrack', trackUri: row.dataset.trackUri });
          });
        });

        favoritesList.querySelectorAll('.track-heart-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const trackId = btn.dataset.trackId;
            const trk = allTracks.find(t => t.id === trackId);
            if (trk) {
              trk.isLiked = false;
              vscode.postMessage({ type: 'toggleTrackLike', trackId });
              renderViews();
            }
          });
        });
      }
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // Message handler from Extension Host
    window.addEventListener('message', event => {
      const msg = event.data;
      if (!msg) return;

      switch (msg.type) {
        case 'stateUpdate':
          renderPlaybackState(msg.state);
          break;

        case 'localLibraryUpdate':
          allTracks = msg.tracks || [];
          allFolders = msg.folders || [];
          renderViews();
          if (currentState) {
            renderPlaybackState(currentState);
          }
          break;

        // Audio controls
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

    // Notify extension host that webview is ready
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
//# sourceMappingURL=musicHtml.js.map