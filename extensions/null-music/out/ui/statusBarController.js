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
exports.StatusBarController = void 0;
const vscode = __importStar(require("vscode"));
const statusBarModel_1 = require("./statusBarModel");
class StatusBarController {
    playbackManager;
    mainItem;
    prevItem;
    playPauseItem;
    nextItem;
    disposables = [];
    constructor(playbackManager) {
        this.playbackManager = playbackManager;
        this.mainItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.mainItem.command = 'null-music.focus';
        this.disposables.push(this.mainItem, this.playbackManager.onDidChangePlaybackState((state) => this.update(state)), vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('null-music.statusBar')) {
                this.rebuildControls();
                this.update(this.playbackManager.getCurrentState());
            }
        }));
        this.rebuildControls();
        this.update(this.playbackManager.getCurrentState());
    }
    rebuildControls() {
        const config = vscode.workspace.getConfiguration('null-music.statusBar');
        const showControls = config.get('showControls', false);
        if (this.prevItem) {
            this.prevItem.dispose();
            this.prevItem = undefined;
        }
        if (this.playPauseItem) {
            this.playPauseItem.dispose();
            this.playPauseItem = undefined;
        }
        if (this.nextItem) {
            this.nextItem.dispose();
            this.nextItem = undefined;
        }
        if (showControls) {
            this.prevItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 103);
            this.prevItem.text = '$(chevron-left)';
            this.prevItem.tooltip = 'Previous Track (Null Music)';
            this.prevItem.command = 'null-music.previousTrack';
            this.prevItem.show();
            this.playPauseItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 102);
            this.playPauseItem.text = '$(play)';
            this.playPauseItem.tooltip = 'Play / Pause (Null Music)';
            this.playPauseItem.command = 'null-music.playPause';
            this.playPauseItem.show();
            this.nextItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
            this.nextItem.text = '$(chevron-right)';
            this.nextItem.tooltip = 'Next Track (Null Music)';
            this.nextItem.command = 'null-music.nextTrack';
            this.nextItem.show();
        }
    }
    update(state) {
        const config = vscode.workspace.getConfiguration('null-music.statusBar');
        const isEnabled = config.get('enabled', true);
        if (!isEnabled) {
            this.mainItem.hide();
            this.prevItem?.hide();
            this.playPauseItem?.hide();
            this.nextItem?.hide();
            return;
        }
        const formatPattern = config.get('format', '${title} - ${artist}');
        const model = (0, statusBarModel_1.buildStatusBarModel)(state, formatPattern);
        this.mainItem.text = model.text;
        const tooltip = new vscode.MarkdownString(model.tooltipText, true);
        tooltip.isTrusted = true;
        this.mainItem.tooltip = tooltip;
        this.mainItem.show();
        if (this.playPauseItem) {
            this.playPauseItem.text = model.isPlaying ? '$(debug-pause)' : '$(play)';
        }
    }
    dispose() {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }
}
exports.StatusBarController = StatusBarController;
//# sourceMappingURL=statusBarController.js.map