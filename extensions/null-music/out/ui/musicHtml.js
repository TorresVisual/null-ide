'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMusicWebviewHtml = getMusicWebviewHtml;
function getMusicWebviewHtml(nonce, cspSource) {
    const effectiveCspSource = cspSource || 'https://*.vscode-cdn.net vscode-webview:';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${effectiveCspSource} https: data: http: vscode-resource: vscode-webview-resource:; style-src 'unsafe-inline' ${effectiveCspSource}; script-src 'nonce-${nonce}'; media-src ${effectiveCspSource} vscode-resource: vscode-webview-resource: vscode-webview: https: blob: http: data:;">
  <title>Null Music</title>
  <style>
    :root {
      --bg-canvas: #181818;
      --bg-surface: #1F1F1F;
      --bg-card: #222222;
      --bg-control: #2B2B2B;
      --bg-control-hover: #363636;
      --border-divider: #2B2B2B;
      --border-control: #3C3C3C;
      --text-primary: #CCCCCC;
      --text-secondary: #9D9D9D;
      --text-disabled: #6E7681;
      --accent: #0078D4;
      --accent-hover: #026EC1;
      --accent-tint: rgba(0, 120, 212, 0.15);
      --danger: #F85149;
      --danger-hover: #da3633;
      --warning: #e3b341;
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

    /* Header Bar */
    .header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 8px;
      margin-bottom: 8px;
      border-bottom: 1px solid var(--border-divider);
      gap: 6px;
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
      flex-shrink: 0;
    }

    .header-mark {
      color: var(--text-primary);
      font-weight: 700;
      font-size: 13px;
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

    .header-actions {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .btn-header {
      background: var(--bg-control);
      border: 1px solid var(--border-control);
      color: var(--text-primary);
      font-family: var(--font-ui);
      font-size: 11px;
      font-weight: 500;
      padding: 4px 7px;
      border-radius: 4px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: background 0.15s, border-color 0.15s;
    }

    .btn-header:hover {
      background: var(--bg-control-hover);
      border-color: var(--accent);
    }

    /* Banners */
    .alert-banner {
      display: none;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 11px;
      margin-bottom: 8px;
      animation: fadeIn 0.2s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .alert-banner.error {
      background: rgba(248, 81, 73, 0.15);
      border: 1px solid var(--danger);
      color: #ff9b9b;
    }

    .alert-banner.prompt {
      background: rgba(0, 120, 212, 0.15);
      border: 1px solid var(--accent);
      color: #9cdcfe;
      cursor: pointer;
    }

    .alert-banner button.close-btn {
      background: transparent;
      border: none;
      color: currentColor;
      font-size: 13px;
      cursor: pointer;
      padding: 0 4px;
    }

    /* Search & Filter Bar */
    .search-filter-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
    }

    .search-wrapper {
      position: relative;
      flex: 1;
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

    .sort-select {
      background: var(--bg-surface);
      border: 1px solid var(--border-divider);
      color: var(--text-secondary);
      font-family: var(--font-ui);
      font-size: 11px;
      padding: 4px 6px;
      border-radius: 4px;
      outline: none;
      cursor: pointer;
    }

    .sort-select:hover {
      border-color: var(--border-control);
      color: var(--text-primary);
    }

    /* Player Hero Card */
    .player-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-divider);
      border-radius: 6px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 10px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    }

    .player-track-row {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    /* Animated Equalizer Wave Badge */
    .player-badge {
      width: 34px;
      height: 34px;
      background: var(--bg-canvas);
      border: 1px solid var(--border-divider);
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      color: var(--accent);
      position: relative;
      overflow: hidden;
    }

    .eq-wave {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 16px;
    }

    .eq-bar {
      width: 3px;
      background: var(--accent);
      border-radius: 1px;
      height: 3px;
      transition: height 0.15s ease;
    }

    .playing .eq-bar:nth-child(1) {
      animation: eqBounce1 0.8s ease-in-out infinite alternate;
    }
    .playing .eq-bar:nth-child(2) {
      animation: eqBounce2 0.6s ease-in-out infinite alternate;
    }
    .playing .eq-bar:nth-child(3) {
      animation: eqBounce3 0.9s ease-in-out infinite alternate;
    }

    @keyframes eqBounce1 { 0% { height: 3px; } 100% { height: 16px; } }
    @keyframes eqBounce2 { 0% { height: 5px; } 100% { height: 13px; } }
    @keyframes eqBounce3 { 0% { height: 2px; } 100% { height: 15px; } }

    .player-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .player-title {
      font-size: 13px;
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
      position: relative;
    }

    .scrubber-bar-container {
      width: 100%;
      height: 14px;
      display: flex;
      align-items: center;
      cursor: pointer;
      position: relative;
    }

    .scrubber-track {
      position: relative;
      width: 100%;
      height: 4px;
      background: var(--border-divider);
      border-radius: 2px;
      overflow: hidden;
      transition: height 0.15s ease;
    }

    .scrubber-bar-container:hover .scrubber-track,
    .scrubber-bar-container.dragging .scrubber-track {
      height: 6px;
    }

    .scrubber-fill {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 0%;
      background: var(--accent);
      border-radius: 2px;
      transition: width 0.05s linear;
    }

    .scrubber-handle {
      position: absolute;
      top: 50%;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #ffffff;
      transform: translate(-50%, -50%);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.15s ease;
    }

    .scrubber-bar-container:hover .scrubber-handle,
    .scrubber-bar-container.dragging .scrubber-handle {
      opacity: 1;
    }

    .scrubber-tooltip {
      position: absolute;
      bottom: 18px;
      font-family: var(--font-mono);
      font-size: 10px;
      background: #2d2d2d;
      border: 1px solid var(--border-control);
      color: #ffffff;
      padding: 1px 4px;
      border-radius: 3px;
      pointer-events: none;
      transform: translateX(-50%);
      display: none;
      white-space: nowrap;
      z-index: 10;
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
      gap: 6px;
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
      transition: color 0.15s, background 0.15s, transform 0.08s;
      position: relative;
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

    .ctrl-btn:active {
      transform: scale(0.92);
    }

    .ctrl-btn.active {
      color: var(--accent);
    }

    .repeat-badge {
      position: absolute;
      top: 1px;
      right: 1px;
      font-size: 8px;
      font-family: var(--font-mono);
      background: var(--accent);
      color: #fff;
      border-radius: 50%;
      width: 10px;
      height: 10px;
      display: none;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }

    .ctrl-btn.repeat-one .repeat-badge {
      display: flex;
    }

    .ctrl-btn-play {
      background: var(--accent);
      color: #ffffff;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    }

    .ctrl-btn-play svg {
      width: 15px;
      height: 15px;
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

    .volume-btn {
      background: transparent;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-secondary);
      padding: 2px;
      border-radius: 3px;
    }

    .volume-btn:hover {
      color: var(--text-primary);
    }

    .volume-btn svg {
      width: 13px;
      height: 13px;
      fill: currentColor;
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
      transition: transform 0.1s ease;
    }

    .volume-slider::-webkit-slider-thumb:hover {
      transform: scale(1.2);
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
      overflow-x: auto;
    }

    .tab-item {
      padding: 6px 10px;
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
      gap: 4px;
      transition: color 0.15s, border-color 0.15s;
      white-space: nowrap;
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
      display: flex;
      align-items: center;
      justify-content: flex-end;
    }

    .track-row.active .track-idx {
      color: var(--accent);
    }

    .row-eq {
      display: none;
      align-items: flex-end;
      gap: 1.5px;
      height: 10px;
      width: 12px;
    }

    .track-row.active.playing .row-eq {
      display: flex;
    }

    .track-row.active.playing .track-num {
      display: none;
    }

    .row-eq span {
      width: 2px;
      background: var(--accent);
      border-radius: 1px;
    }

    .row-eq span:nth-child(1) { animation: eqBounce1 0.7s infinite alternate; }
    .row-eq span:nth-child(2) { animation: eqBounce2 0.5s infinite alternate; }
    .row-eq span:nth-child(3) { animation: eqBounce3 0.8s infinite alternate; }

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

    /* Cards (Playlists & Folders) */
    .item-card {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 9px;
      background: var(--bg-surface);
      border: 1px solid var(--border-divider);
      border-radius: 5px;
      margin-bottom: 4px;
      cursor: pointer;
      transition: background 0.12s, border-color 0.12s;
    }

    .item-card:hover {
      background: var(--bg-control);
      border-color: var(--border-control);
    }

    .item-card-icon {
      width: 18px;
      height: 18px;
      fill: var(--accent);
      flex-shrink: 0;
    }

    .item-card-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .item-card-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .item-card-sub {
      font-size: 10px;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .item-card-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .card-action-btn {
      background: transparent;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
      border-radius: 3px;
      transition: color 0.12s, background 0.12s;
    }

    .card-action-btn:hover {
      color: var(--text-primary);
      background: var(--bg-control-hover);
    }

    .card-action-btn.danger:hover {
      color: var(--danger);
    }

    .card-action-btn svg {
      width: 13px;
      height: 13px;
      fill: currentColor;
    }

    /* Playlist Detail View */
    .playlist-detail-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 8px;
      margin-bottom: 6px;
      border-bottom: 1px solid var(--border-divider);
    }

    .btn-back {
      background: transparent;
      border: none;
      color: var(--accent);
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .btn-back:hover {
      text-decoration: underline;
    }

    .playlist-detail-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Empty States */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 28px 16px;
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

    .import-hero-btn {
      background: var(--accent-tint);
      border: 1px dashed var(--accent);
      color: #ffffff;
      padding: 8px 12px;
      border-radius: 5px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
      transition: background 0.15s;
    }

    .import-hero-btn:hover {
      background: rgba(0, 120, 212, 0.25);
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
    <div class="header-actions">
      <button id="btn-import-playlist" class="btn-header" title="Import .m3u8 or .m3u playlist file">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
          <path d="M14 0H2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2zM1 3.857C1 3.384 1.448 3 2 3h12c.552 0 1 .384 1 .857v10.286c0 .473-.448.857-1 .857H2c-.552 0-1-.384-1-.857V3.857z"/>
          <path d="M6.5 7.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1H7v2.5a1.5 1.5 0 1 1-1.5-1.5.5.5 0 0 1 .5.5v-2z"/>
        </svg>
        + Playlist
      </button>
      <button id="btn-add-folder" class="btn-header" title="Add music folder">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
          <path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/>
        </svg>
        + Folder
      </button>
    </div>
  </div>

  <!-- Error Banner -->
  <div id="error-banner" class="alert-banner error">
    <span id="error-message">Error loading track</span>
    <button id="btn-close-error" class="close-btn" title="Dismiss">×</button>
  </div>

  <!-- Autoplay Prompt -->
  <div id="autoplay-prompt" class="alert-banner prompt">
    <span>Audio paused by browser policy. Click anywhere to play.</span>
  </div>

  <!-- Search / Filter Bar -->
  <div class="search-filter-row">
    <div class="search-wrapper">
      <svg class="search-icon" viewBox="0 0 16 16">
        <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
      </svg>
      <input id="search-input" class="search-input" type="text" placeholder="Filter tracks, artists, playlists…" autocomplete="off" spellcheck="false" />
      <button id="btn-search-clear" class="search-clear" title="Clear">×</button>
    </div>
    <select id="sort-select" class="sort-select" title="Sort tracks">
      <option value="default">Default</option>
      <option value="title">Title (A-Z)</option>
      <option value="artist">Artist (A-Z)</option>
      <option value="duration">Duration</option>
    </select>
  </div>

  <!-- Now Playing Hero Card -->
  <div id="player-card" class="player-card">
    <div class="player-track-row">
      <div id="player-badge" class="player-badge">
        <div class="eq-wave">
          <div class="eq-bar"></div>
          <div class="eq-bar"></div>
          <div class="eq-bar"></div>
        </div>
      </div>
      <div class="player-info">
        <div id="player-title" class="player-title">No Track Playing</div>
        <div id="player-artist" class="player-artist">Add a folder or import a playlist</div>
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
        <div id="scrubber-handle" class="scrubber-handle"></div>
        <div id="scrubber-tooltip" class="scrubber-tooltip">0:00</div>
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

      <button id="btn-rewind-10" class="ctrl-btn" title="Rewind 10 Seconds">
        <svg viewBox="0 0 16 16"><path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/><path d="M8 1v3l-2.5-1.5L8 1z"/></svg>
      </button>

      <button id="btn-play-pause" class="ctrl-btn ctrl-btn-play" title="Play / Pause (Space)">
        <svg id="icon-play" viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>
        <svg id="icon-pause" viewBox="0 0 16 16" style="display: none;"><path d="M3.5 2.5h3v11h-3zm6 0h3v11h-3z"/></svg>
      </button>

      <button id="btn-forward-10" class="ctrl-btn" title="Forward 10 Seconds">
        <svg viewBox="0 0 16 16"><path d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2v1z"/><path d="M8 1v3l2.5-1.5L8 1z"/></svg>
      </button>

      <button id="btn-next" class="ctrl-btn" title="Next Track">
        <svg viewBox="0 0 16 16"><path d="M12.5 2v12H11V8.8L3.5 14V2L11 7.2V2h1.5z"/></svg>
      </button>

      <button id="btn-repeat" class="ctrl-btn" title="Toggle Repeat Mode">
        <svg viewBox="0 0 16 16"><path d="M11 1v2H4.5C2.6 3 1 4.6 1 6.5S2.6 10 4.5 10H5V8.5h-.5C3.4 8.5 2.5 7.6 2.5 6.5S3.4 4.5 4.5 4.5H11V6.5l3.5-2.75L11 1zm.5 5H11v1.5h.5c1.1 0 2 .9 2 2s-.9 2-2 2H5V9.5L1.5 12.25 5 15v-2h6.5c1.9 0 3.5-1.6 3.5-3.5S13.4 6 11.5 6z"/></svg>
        <span class="repeat-badge">1</span>
      </button>
    </div>

    <!-- Volume -->
    <div class="volume-row">
      <button id="btn-volume-icon" class="volume-btn" title="Mute / Unmute">
        <svg id="icon-vol-normal" viewBox="0 0 16 16"><path d="M8.5 2.2L4.3 6H1.5C1.2 6 1 6.2 1 6.5v3c0 .3.2.5.5.5h2.8l4.2 3.8c.4.3.9 0 .9-.5v-10.6c0-.5-.5-.8-.9-.5zM11.5 8c0-1.3-.7-2.4-1.8-3v6c1.1-.6 1.8-1.7 1.8-3z"/></svg>
        <svg id="icon-vol-mute" viewBox="0 0 16 16" style="display: none;"><path d="M8.5 2.2L4.3 6H1.5C1.2 6 1 6.2 1 6.5v3c0 .3.2.5.5.5h2.8l4.2 3.8c.4.3.9 0 .9-.5v-10.6c0-.5-.5-.8-.9-.5zM11 6.2l1.4-1.4 1.4 1.4-1.4 1.4 1.4 1.4-1.4 1.4-1.4-1.4-1.4 1.4-1.4-1.4 1.4-1.4-1.4-1.4 1.4-1.4z"/></svg>
      </button>
      <input id="volume-slider" class="volume-slider" type="range" min="0" max="100" value="80" />
      <span id="volume-text" class="volume-text">80%</span>
    </div>
  </div>

  <!-- Navigation Tabs -->
  <div class="tabs-bar">
    <button class="tab-item active" data-tab="tracks">
      Tracks <span id="tab-count-tracks" class="tab-count">0</span>
    </button>
    <button class="tab-item" data-tab="playlists">
      Playlists <span id="tab-count-playlists" class="tab-count">0</span>
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
      <div class="empty-desc">Click "Import Playlist" or "Add Folder" to start playing your music.</div>
      <button id="empty-tracks-btn" class="import-hero-btn">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
          <path d="M14 0H2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2zM1 3.857C1 3.384 1.448 3 2 3h12c.552 0 1 .384 1 .857v10.286c0 .473-.448.857-1 .857H2c-.552 0-1-.384-1-.857V3.857z"/>
        </svg>
        Import .m3u8 Playlist
      </button>
    </div>
  </div>

  <!-- Playlists Pane -->
  <div id="pane-playlists" class="tab-pane">
    <div id="playlist-detail-container" style="display: none;">
      <div class="playlist-detail-header">
        <button id="btn-back-playlists" class="btn-back">
          ← Back
        </button>
        <span id="playlist-detail-title" class="playlist-detail-title">Playlist</span>
        <button id="btn-play-detail-playlist" class="btn-header" title="Play Playlist">
          <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M4 2.5v11l9-5.5z"/></svg>
          Play All
        </button>
      </div>
      <div id="playlist-detail-tracks"></div>
    </div>

    <div id="playlists-overview">
      <div id="playlists-list"></div>
      <div id="empty-playlists" class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-title">No Playlists Imported</div>
        <div class="empty-desc">Import .m3u8 or .m3u playlist files with all your favorite songs and tracks.</div>
        <button id="btn-import-playlist-card" class="import-hero-btn">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
            <path d="M14 0H2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2zM1 3.857C1 3.384 1.448 3 2 3h12c.552 0 1 .384 1 .857v10.286c0 .473-.448.857-1 .857H2c-.552 0-1-.384-1-.857V3.857z"/>
          </svg>
          Import .m3u8 Playlist
        </button>
      </div>
    </div>
  </div>

  <!-- Folders Pane -->
  <div id="pane-folders" class="tab-pane">
    <div id="folders-list"></div>
    <div id="empty-folders" class="empty-state">
      <div class="empty-icon">📁</div>
      <div class="empty-title">No Folders Added</div>
      <div class="empty-desc">Add a folder containing audio files from your computer.</div>
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
    let allPlaylists = [];
    let currentState = null;
    let activeTab = 'tracks';
    let searchQuery = '';
    let sortMode = 'default';
    let selectedPlaylistId = null;
    let isDraggingScrubber = false;
    let previousVolume = 80;
    let currentPlayingTrackUri = null;
    let pendingSeekMs = 0;
    let timeUpdateThrottle = 0;

    // Elements
    const audioPlayer = document.getElementById('audio-player');
    const badgeTotalTracks = document.getElementById('badge-total-tracks');
    const btnAddFolder = document.getElementById('btn-add-folder');
    const btnImportPlaylist = document.getElementById('btn-import-playlist');
    const btnImportPlaylistCard = document.getElementById('btn-import-playlist-card');
    const emptyTracksBtn = document.getElementById('empty-tracks-btn');
    const searchInput = document.getElementById('search-input');
    const btnSearchClear = document.getElementById('btn-search-clear');
    const sortSelect = document.getElementById('sort-select');

    const errorBanner = document.getElementById('error-banner');
    const errorMessage = document.getElementById('error-message');
    const btnCloseError = document.getElementById('btn-close-error');
    const autoplayPrompt = document.getElementById('autoplay-prompt');

    const playerCard = document.getElementById('player-card');
    const playerTitle = document.getElementById('player-title');
    const playerArtist = document.getElementById('player-artist');
    const btnLike = document.getElementById('btn-like');
    const progressBarContainer = document.getElementById('progress-bar-container');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const scrubberHandle = document.getElementById('scrubber-handle');
    const scrubberTooltip = document.getElementById('scrubber-tooltip');
    const timeCurrent = document.getElementById('time-current');
    const timeDuration = document.getElementById('time-duration');

    const btnShuffle = document.getElementById('btn-shuffle');
    const btnPrev = document.getElementById('btn-prev');
    const btnRewind10 = document.getElementById('btn-rewind-10');
    const btnPlayPause = document.getElementById('btn-play-pause');
    const iconPlay = document.getElementById('icon-play');
    const iconPause = document.getElementById('icon-pause');
    const btnForward10 = document.getElementById('btn-forward-10');
    const btnNext = document.getElementById('btn-next');
    const btnRepeat = document.getElementById('btn-repeat');

    const btnVolumeIcon = document.getElementById('btn-volume-icon');
    const iconVolNormal = document.getElementById('icon-vol-normal');
    const iconVolMute = document.getElementById('icon-vol-mute');
    const volumeSlider = document.getElementById('volume-slider');
    const volumeText = document.getElementById('volume-text');

    const tabCountTracks = document.getElementById('tab-count-tracks');
    const tabCountPlaylists = document.getElementById('tab-count-playlists');
    const tabCountFolders = document.getElementById('tab-count-folders');
    const tabCountFavorites = document.getElementById('tab-count-favorites');

    const paneTracks = document.getElementById('pane-tracks');
    const panePlaylists = document.getElementById('pane-playlists');
    const paneFolders = document.getElementById('pane-folders');
    const paneFavorites = document.getElementById('pane-favorites');

    const tracksList = document.getElementById('tracks-list');
    const playlistsOverview = document.getElementById('playlists-overview');
    const playlistsList = document.getElementById('playlists-list');
    const playlistDetailContainer = document.getElementById('playlist-detail-container');
    const playlistDetailTitle = document.getElementById('playlist-detail-title');
    const playlistDetailTracks = document.getElementById('playlist-detail-tracks');
    const btnBackPlaylists = document.getElementById('btn-back-playlists');
    const btnPlayDetailPlaylist = document.getElementById('btn-play-detail-playlist');

    const foldersList = document.getElementById('folders-list');
    const favoritesList = document.getElementById('favorites-list');

    const emptyTracks = document.getElementById('empty-tracks');
    const emptyPlaylists = document.getElementById('empty-playlists');
    const emptyFolders = document.getElementById('empty-folders');
    const emptyFavorites = document.getElementById('empty-favorites');

    // Helper: format milliseconds into mm:ss
    function formatTime(ms) {
      if (!ms || ms < 0 || isNaN(ms)) return '0:00';
      const totalSeconds = Math.floor(ms / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
    }

    function showError(msg) {
      errorMessage.textContent = msg || 'Playback error';
      errorBanner.style.display = 'flex';
    }

    function hideError() {
      errorBanner.style.display = 'none';
    }

    btnCloseError.addEventListener('click', hideError);

    // Tab Switching
    document.querySelectorAll('.tab-item').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeTab = btn.dataset.tab;

        [paneTracks, panePlaylists, paneFolders, paneFavorites].forEach(p => p.classList.remove('active'));
        if (activeTab === 'tracks') paneTracks.classList.add('active');
        else if (activeTab === 'playlists') panePlaylists.classList.add('active');
        else if (activeTab === 'folders') paneFolders.classList.add('active');
        else if (activeTab === 'favorites') paneFavorites.classList.add('active');

        renderViews();
      });
    });

    // Search and Sort
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

    sortSelect.addEventListener('change', (e) => {
      sortMode = e.target.value;
      renderViews();
    });

    // Actions: Folder & Playlist import
    btnAddFolder.addEventListener('click', () => {
      vscode.postMessage({ type: 'localOpenFolder' });
    });

    function triggerImportPlaylist() {
      vscode.postMessage({ type: 'localImportPlaylist' });
    }

    btnImportPlaylist.addEventListener('click', triggerImportPlaylist);
    if (btnImportPlaylistCard) btnImportPlaylistCard.addEventListener('click', triggerImportPlaylist);
    if (emptyTracksBtn) emptyTracksBtn.addEventListener('click', triggerImportPlaylist);

    // Playback controls
    btnPlayPause.addEventListener('click', () => vscode.postMessage({ type: 'playPause' }));
    btnPrev.addEventListener('click', () => vscode.postMessage({ type: 'previous' }));
    btnNext.addEventListener('click', () => vscode.postMessage({ type: 'next' }));
    btnShuffle.addEventListener('click', () => vscode.postMessage({ type: 'toggleShuffle' }));
    btnRepeat.addEventListener('click', () => vscode.postMessage({ type: 'toggleRepeat' }));
    btnLike.addEventListener('click', () => vscode.postMessage({ type: 'toggleLike' }));

    btnRewind10.addEventListener('click', () => {
      const cur = (audioPlayer && !isNaN(audioPlayer.currentTime))
        ? audioPlayer.currentTime * 1000
        : (currentState?.progressMs || 0);
      const target = Math.max(0, cur - 10000);
      seekTo(target);
    });

    btnForward10.addEventListener('click', () => {
      const cur = (audioPlayer && !isNaN(audioPlayer.currentTime))
        ? audioPlayer.currentTime * 1000
        : (currentState?.progressMs || 0);
      const target = Math.min(currentState?.durationMs || Infinity, cur + 10000);
      seekTo(target);
    });

    // Volume
    volumeSlider.addEventListener('input', (e) => {
      const vol = parseInt(e.target.value, 10);
      setVolume(vol);
    });

    btnVolumeIcon.addEventListener('click', () => {
      if (audioPlayer.volume > 0) {
        previousVolume = Math.round(audioPlayer.volume * 100) || 80;
        setVolume(0);
      } else {
        setVolume(previousVolume || 80);
      }
    });

    function setVolume(vol) {
      volumeSlider.value = vol;
      volumeText.textContent = vol + '%';
      if (audioPlayer) audioPlayer.volume = vol / 100;
      iconVolNormal.style.display = vol > 0 ? 'block' : 'none';
      iconVolMute.style.display = vol === 0 ? 'block' : 'none';
      vscode.postMessage({ type: 'setVolume', volumePercent: vol });
    }

    // Scrubber drag & click
    function getScrubberTargetMs(clientX) {
      if (!currentState || !currentState.durationMs) return 0;
      const rect = progressBarContainer.getBoundingClientRect();
      const clickX = clientX - rect.left;
      const pct = Math.max(0, Math.min(1, clickX / rect.width));
      return Math.floor(pct * currentState.durationMs);
    }

    function updateScrubberUi(ms, durationMs) {
      if (!durationMs) return;
      const pct = Math.max(0, Math.min(100, (ms / durationMs) * 100));
      progressBarFill.style.width = pct + '%';
      scrubberHandle.style.left = pct + '%';
      timeCurrent.textContent = formatTime(ms);
    }

    function seekTo(targetMs) {
      if (currentState) {
        currentState.progressMs = targetMs;
        currentState.timestamp = Date.now();
        updateScrubberUi(targetMs, currentState.durationMs);
      }
      if (audioPlayer && audioPlayer.src && !isNaN(audioPlayer.duration)) {
        audioPlayer.currentTime = targetMs / 1000;
      }
      vscode.postMessage({ type: 'seek', positionMs: targetMs });
    }

    progressBarContainer.addEventListener('mousedown', (e) => {
      if (!currentState || !currentState.durationMs) return;
      isDraggingScrubber = true;
      progressBarContainer.classList.add('dragging');
      const targetMs = getScrubberTargetMs(e.clientX);
      updateScrubberUi(targetMs, currentState.durationMs);
    });

    progressBarContainer.addEventListener('mousemove', (e) => {
      if (!currentState || !currentState.durationMs) return;
      const rect = progressBarContainer.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, clickX / rect.width));
      const hoverMs = Math.floor(pct * currentState.durationMs);

      scrubberTooltip.style.display = 'block';
      scrubberTooltip.style.left = (pct * 100) + '%';
      scrubberTooltip.textContent = formatTime(hoverMs);

      if (isDraggingScrubber) {
        updateScrubberUi(hoverMs, currentState.durationMs);
      }
    });

    progressBarContainer.addEventListener('mouseleave', () => {
      scrubberTooltip.style.display = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (isDraggingScrubber && currentState?.durationMs) {
        const targetMs = getScrubberTargetMs(e.clientX);
        updateScrubberUi(targetMs, currentState.durationMs);
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (isDraggingScrubber) {
        isDraggingScrubber = false;
        progressBarContainer.classList.remove('dragging');
        const targetMs = getScrubberTargetMs(e.clientX);
        seekTo(targetMs);
      }
    });

    // Keyboard navigation
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        vscode.postMessage({ type: 'playPause' });
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        btnRewind10.click();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        btnForward10.click();
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        const next = Math.min(100, parseInt(volumeSlider.value, 10) + 5);
        setVolume(next);
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        const next = Math.max(0, parseInt(volumeSlider.value, 10) - 5);
        setVolume(next);
      } else if (e.key === 'm' || e.key === 'M') {
        btnVolumeIcon.click();
      }
    });

    // Audio Element Event Handlers
    audioPlayer.addEventListener('play', () => {
      hideError();
      autoplayPrompt.style.display = 'none';
      playerCard.classList.add('playing');
      vscode.postMessage({ type: 'localAudioPlayStarted' });
    });

    audioPlayer.addEventListener('pause', () => {
      playerCard.classList.remove('playing');
      vscode.postMessage({
        type: 'localAudioPaused',
        positionMs: Math.round(audioPlayer.currentTime * 1000),
        trackUri: currentPlayingTrackUri
      });
    });

    audioPlayer.addEventListener('timeupdate', () => {
      if (isDraggingScrubber) return;
      const curMs = Math.round(audioPlayer.currentTime * 1000);
      const durMs = Math.round((audioPlayer.duration || 0) * 1000) || (currentState?.durationMs || 0);

      timeCurrent.textContent = formatTime(curMs);
      if (durMs > 0) {
        const pct = Math.max(0, Math.min(100, (curMs / durMs) * 100));
        progressBarFill.style.width = pct + '%';
        scrubberHandle.style.left = pct + '%';
      }

      // Throttle postMessage to extension host (once every ~1.5s)
      const now = Date.now();
      if (now - timeUpdateThrottle > 1500) {
        timeUpdateThrottle = now;
        vscode.postMessage({ type: 'localAudioTimeUpdate', positionMs: curMs, trackUri: currentPlayingTrackUri });
      }
    });

    audioPlayer.addEventListener('loadedmetadata', () => {
      if (pendingSeekMs > 0) {
        audioPlayer.currentTime = pendingSeekMs / 1000;
        pendingSeekMs = 0;
      }
      const durationMs = Math.round(audioPlayer.duration * 1000);
      timeDuration.textContent = formatTime(durationMs);
      if (currentState) {
        currentState.durationMs = durationMs;
      }
      vscode.postMessage({
        type: 'localAudioDuration',
        durationMs,
        trackUri: currentPlayingTrackUri
      });
    });

    audioPlayer.addEventListener('ended', () => {
      playerCard.classList.remove('playing');
      vscode.postMessage({ type: 'localAudioEnded', trackUri: currentPlayingTrackUri });
    });

    audioPlayer.addEventListener('error', () => {
      playerCard.classList.remove('playing');
      const err = audioPlayer.error;
      let msg = 'Failed to load audio file';
      if (err) {
        if (err.code === 1) msg = 'Audio loading was aborted';
        else if (err.code === 2) msg = 'Network or filesystem error loading audio';
        else if (err.code === 3) msg = 'Audio decode error: format unsupported or file corrupted';
        else if (err.code === 4) msg = 'Audio source not supported or file inaccessible';
      }
      showError(msg);
      vscode.postMessage({
        type: 'localAudioError',
        error: msg,
        trackUri: currentPlayingTrackUri
      });
    });

    // Start playback; report real failures, but not a play() that a pause() or a new load interrupted.
    function startPlayback(trackUri) {
      const playPromise = audioPlayer.play();
      if (playPromise === undefined) return;
      playPromise.catch(err => {
        if (err.name === 'AbortError') return;
        if (err.name === 'NotAllowedError') {
          autoplayPrompt.style.display = 'flex';
          playerCard.classList.remove('playing');
        } else {
          showError('Audio play failed: ' + err.message);
        }
        vscode.postMessage({
          type: 'localAudioPlayFailed',
          error: err.name + ': ' + err.message,
          trackUri: trackUri,
          silent: err.name === 'NotAllowedError'
        });
      });
    }

    // Autoplay unlock
    autoplayPrompt.addEventListener('click', () => {
      audioPlayer.play().then(() => {
        autoplayPrompt.style.display = 'none';
      }).catch(err => {
        showError('Play failed: ' + err.message);
      });
    });

    // Playback state rendering
    function renderPlaybackState(state) {
      currentState = state;
      if (!state || !state.track) {
        playerTitle.textContent = 'No Track Playing';
        playerArtist.textContent = allTracks.length > 0 ? 'Select a track to start playback' : 'Import a playlist or add a folder';
        iconPlay.style.display = 'block';
        iconPause.style.display = 'none';
        playerCard.classList.remove('playing');
        progressBarFill.style.width = '0%';
        scrubberHandle.style.left = '0%';
        timeCurrent.textContent = '0:00';
        timeDuration.textContent = '0:00';
        btnLike.classList.remove('liked');
        updateActiveTrackRow(null, false);
        return;
      }

      const t = state.track;
      playerTitle.textContent = t.name;
      playerArtist.textContent = t.artist + (t.album ? ' • ' + t.album : '');
      btnLike.classList.toggle('liked', !!t.isLiked);

      if (state.isPlaying) {
        iconPlay.style.display = 'none';
        iconPause.style.display = 'block';
        playerCard.classList.add('playing');
      } else {
        iconPlay.style.display = 'block';
        iconPause.style.display = 'none';
        playerCard.classList.remove('playing');
      }

      btnShuffle.classList.toggle('active', !!state.shuffle);

      btnRepeat.classList.toggle('active', state.repeat !== 'off');
      btnRepeat.classList.toggle('repeat-one', state.repeat === 'track');
      btnRepeat.title = 'Repeat: ' + (state.repeat === 'track' ? 'One Track' : state.repeat === 'context' ? 'All' : 'Off');

      if (typeof state.volume === 'number') {
        volumeSlider.value = state.volume;
        volumeText.textContent = state.volume + '%';
        if (audioPlayer) audioPlayer.volume = state.volume / 100;
        iconVolNormal.style.display = state.volume > 0 ? 'block' : 'none';
        iconVolMute.style.display = state.volume === 0 ? 'block' : 'none';
      }

      timeDuration.textContent = formatTime(state.durationMs);

      if (!isDraggingScrubber) {
        const curMs = (audioPlayer && audioPlayer.src && !isNaN(audioPlayer.currentTime))
          ? audioPlayer.currentTime * 1000
          : (state.progressMs || 0);
        updateScrubberUi(curMs, state.durationMs);
      }

      updateActiveTrackRow(t.uri, state.isPlaying);
    }

    function updateActiveTrackRow(activeUri, isPlaying) {
      document.querySelectorAll('.track-row').forEach(row => {
        const isMatch = row.dataset.trackUri === activeUri;
        row.classList.toggle('active', isMatch);
        row.classList.toggle('playing', isMatch && isPlaying);
      });
    }

    // Sort tracks helper
    function getSortedTracks(tracks) {
      const copy = [...tracks];
      if (sortMode === 'title') {
        copy.sort((a, b) => a.name.localeCompare(b.name));
      } else if (sortMode === 'artist') {
        copy.sort((a, b) => a.artist.localeCompare(b.artist));
      } else if (sortMode === 'duration') {
        copy.sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0));
      }
      return copy;
    }

    // Views rendering
    function renderViews() {
      // 1. Badge counts
      badgeTotalTracks.textContent = allTracks.length + ' tracks';
      tabCountTracks.textContent = allTracks.length;
      tabCountPlaylists.textContent = allPlaylists.length;
      tabCountFolders.textContent = allFolders.length;
      tabCountFavorites.textContent = allTracks.filter(t => !!t.isLiked).length;

      renderTracksPane();
      renderPlaylistsPane();
      renderFoldersPane();
      renderFavoritesPane();
    }

    function renderTrackHtml(t, idx) {
      const isAct = currentState?.track?.uri === t.uri;
      const isPl = isAct && currentState?.isPlaying;
      const likedClass = t.isLiked ? 'liked' : '';
      return '<div class="track-row ' + (isAct ? 'active' : '') + ' ' + (isPl ? 'playing' : '') + '" data-track-uri="' + t.uri + '">' +
        '<div class="track-idx">' +
          '<span class="track-num">' + (idx + 1) + '</span>' +
          '<div class="row-eq"><span></span><span></span><span></span></div>' +
        '</div>' +
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
    }

    function attachTrackEvents(container) {
      container.querySelectorAll('.track-row').forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.track-heart-btn')) return;
          vscode.postMessage({ type: 'localPlayTrack', trackUri: row.dataset.trackUri });
        });
      });

      container.querySelectorAll('.track-heart-btn').forEach(btn => {
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

    function renderTracksPane() {
      let filtered = allTracks;
      if (searchQuery) {
        filtered = allTracks.filter(t =>
          t.name.toLowerCase().includes(searchQuery) ||
          t.artist.toLowerCase().includes(searchQuery) ||
          (t.album && t.album.toLowerCase().includes(searchQuery))
        );
      }

      filtered = getSortedTracks(filtered);

      if (filtered.length === 0) {
        tracksList.innerHTML = '';
        emptyTracks.style.display = 'flex';
        if (searchQuery) {
          emptyTracks.querySelector('.empty-title').textContent = 'No Matches';
          emptyTracks.querySelector('.empty-desc').textContent = 'No tracks match "' + searchQuery + '".';
        } else {
          emptyTracks.querySelector('.empty-title').textContent = 'No Tracks Found';
          emptyTracks.querySelector('.empty-desc').textContent = 'Click "Import Playlist" or "Add Folder" to add audio files.';
        }
      } else {
        emptyTracks.style.display = 'none';
        tracksList.innerHTML = filtered.map((t, idx) => renderTrackHtml(t, idx)).join('');
        attachTrackEvents(tracksList);
      }
    }

    // 2. Playlists Pane
    function renderPlaylistsPane() {
      if (selectedPlaylistId) {
        const pl = allPlaylists.find(p => p.id === selectedPlaylistId);
        if (pl) {
          playlistsOverview.style.display = 'none';
          playlistDetailContainer.style.display = 'block';
          playlistDetailTitle.textContent = pl.name + ' (' + (pl.tracks?.length || pl.trackCount || 0) + ')';

          const tracks = pl.tracks || [];
          if (tracks.length === 0) {
            playlistDetailTracks.innerHTML = '<div class="empty-state"><div class="empty-title">Empty Playlist</div></div>';
          } else {
            playlistDetailTracks.innerHTML = tracks.map((t, idx) => renderTrackHtml(t, idx)).join('');
            attachTrackEvents(playlistDetailTracks);
          }
          return;
        }
      }

      playlistDetailContainer.style.display = 'none';
      playlistsOverview.style.display = 'block';

      let filtered = allPlaylists;
      if (searchQuery) {
        filtered = allPlaylists.filter(p =>
          p.name.toLowerCase().includes(searchQuery) ||
          (p.filePath && p.filePath.toLowerCase().includes(searchQuery))
        );
      }

      if (filtered.length === 0) {
        playlistsList.innerHTML = '';
        emptyPlaylists.style.display = 'flex';
      } else {
        emptyPlaylists.style.display = 'none';
        playlistsList.innerHTML = filtered.map(p => {
          const count = p.tracks?.length || p.trackCount || 0;
          return '<div class="item-card" data-playlist-id="' + p.id + '">' +
            '<svg class="item-card-icon" viewBox="0 0 16 16">' +
              '<path d="M12 13c0 1.105-1.12 2-2.5 2S7 14.105 7 13s1.12-2 2.5-2 2.5.895 2.5 2z"/>' +
              '<path fill-rule="evenodd" d="M12 3v10h-1V3h1z"/>' +
              '<path d="M11 2.82a1 1 0 0 1 .804-.98l3-1.5A1 1 0 0 1 16 1.22V3a1 1 0 0 1-1 1h-4V2.82z"/>' +
              '<path fill-rule="evenodd" d="M0 11.5a.5.5 0 0 1 .5-.5H4a.5.5 0 0 1 0 1H.5a.5.5 0 0 1-.5-.5zm0-4A.5.5 0 0 1 .5 7H8a.5.5 0 0 1 0 1H.5a.5.5 0 0 1-.5-.5zm0-4A.5.5 0 0 1 .5 3H8a.5.5 0 0 1 0 1H.5a.5.5 0 0 1-.5-.5z"/>' +
            '</svg>' +
            '<div class="item-card-info">' +
              '<div class="item-card-name">' + escapeHtml(p.name) + ' <span class="tab-count">(' + count + ' tracks)</span></div>' +
              '<div class="item-card-sub">' + escapeHtml(p.filePath || 'Playlist') + '</div>' +
            '</div>' +
            '<div class="item-card-actions">' +
              '<button class="card-action-btn playlist-play-btn" data-playlist-id="' + p.id + '" title="Play Playlist">' +
                '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>' +
              '</button>' +
              '<button class="card-action-btn danger playlist-remove-btn" data-playlist-id="' + p.id + '" title="Remove Playlist">' +
                '<svg viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>' +
              '</button>' +
            '</div>' +
          '</div>';
        }).join('');

        playlistsList.querySelectorAll('.item-card').forEach(card => {
          card.addEventListener('click', (e) => {
            if (e.target.closest('.card-action-btn')) return;
            selectedPlaylistId = card.dataset.playlistId;
            renderPlaylistsPane();
          });
        });

        playlistsList.querySelectorAll('.playlist-play-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'localPlayPlaylist', playlistId: btn.dataset.playlistId });
          });
        });

        playlistsList.querySelectorAll('.playlist-remove-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'localRemovePlaylist', playlistId: btn.dataset.playlistId });
          });
        });
      }
    }

    btnBackPlaylists.addEventListener('click', () => {
      selectedPlaylistId = null;
      renderPlaylistsPane();
    });

    btnPlayDetailPlaylist.addEventListener('click', () => {
      if (selectedPlaylistId) {
        vscode.postMessage({ type: 'localPlayPlaylist', playlistId: selectedPlaylistId });
      }
    });

    // 3. Folders Pane
    function renderFoldersPane() {
      if (allFolders.length === 0) {
        foldersList.innerHTML = '';
        emptyFolders.style.display = 'flex';
      } else {
        emptyFolders.style.display = 'none';
        foldersList.innerHTML = allFolders.map(f => {
          const fName = f.split('/').pop() || f.split('\\\\').pop() || f;
          const count = allTracks.filter(t => t.folder === f).length;
          return '<div class="item-card" data-folder-uri="' + f + '">' +
            '<svg class="item-card-icon" viewBox="0 0 16 16"><path d="M.54 3.87.5 3a2 2 0 0 1 2-2h3.19a2 2 0 0 1 1.45.63l.41.44H14a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-1.49l.54-7.13zM2 14h12V5H9.19l-.61-.65a.5.5 0 0 0-.36-.15H2.5a.5.5 0 0 0-.5.5L2 14z"/></svg>' +
            '<div class="item-card-info">' +
              '<div class="item-card-name">' + escapeHtml(fName) + ' <span class="tab-count">(' + count + ')</span></div>' +
              '<div class="item-card-sub">' + escapeHtml(f) + '</div>' +
            '</div>' +
            '<div class="item-card-actions">' +
              '<button class="card-action-btn folder-play-btn" data-folder-uri="' + f + '" title="Play Folder">' +
                '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>' +
              '</button>' +
              '<button class="card-action-btn danger folder-remove-btn" data-folder-uri="' + f + '" title="Remove Folder">' +
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
    }

    // 4. Favorites Pane
    function renderFavoritesPane() {
      const likedTracks = allTracks.filter(t => !!t.isLiked);
      let favList = likedTracks;
      if (searchQuery) {
        favList = likedTracks.filter(t =>
          t.name.toLowerCase().includes(searchQuery) ||
          t.artist.toLowerCase().includes(searchQuery)
        );
      }
      favList = getSortedTracks(favList);

      if (favList.length === 0) {
        favoritesList.innerHTML = '';
        emptyFavorites.style.display = 'flex';
      } else {
        emptyFavorites.style.display = 'none';
        favoritesList.innerHTML = favList.map((t, idx) => renderTrackHtml(t, idx)).join('');
        attachTrackEvents(favoritesList);
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
          allPlaylists = msg.playlists || [];
          renderViews();
          if (currentState) {
            renderPlaybackState(currentState);
          }
          break;

        // Audio controls
        case 'localLoad':
          currentPlayingTrackUri = msg.trackUri;
          pendingSeekMs = msg.startMs > 0 ? msg.startMs : 0;
          hideError();
          if (audioPlayer && msg.uri) {
            if (audioPlayer.src !== msg.uri) {
              audioPlayer.src = msg.uri;
            } else {
              audioPlayer.currentTime = pendingSeekMs / 1000;
              pendingSeekMs = 0;
            }
            if (msg.autoplay) {
              startPlayback(msg.trackUri);
            }
          }
          break;

        case 'localPause':
          if (audioPlayer) {
            audioPlayer.pause();
            playerCard.classList.remove('playing');
          }
          break;

        case 'localResume':
          if (audioPlayer) {
            startPlayback(currentPlayingTrackUri);
          }
          break;

        case 'localSeek':
          if (audioPlayer && typeof msg.positionMs === 'number') {
            audioPlayer.currentTime = msg.positionMs / 1000;
          }
          break;

        case 'localVolume':
          if (audioPlayer && typeof msg.volumePercent === 'number') {
            audioPlayer.volume = msg.volumePercent / 100;
            volumeSlider.value = msg.volumePercent;
            volumeText.textContent = msg.volumePercent + '%';
            iconVolNormal.style.display = msg.volumePercent > 0 ? 'block' : 'none';
            iconVolMute.style.display = msg.volumePercent === 0 ? 'block' : 'none';
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