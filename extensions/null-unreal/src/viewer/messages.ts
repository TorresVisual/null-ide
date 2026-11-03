import type { Kind } from '../exportFormat';

// Host -> webview. `extra` carries page-specific data (the material-instance parent chain).
export type ToWebview =
  | { type: 'exporting' }
  | { type: 'failed'; error: string; hint?: string }
  | { type: 'stale' }
  | {
      type: 'ready';
      name: string;
      kind: Kind;
      data: Record<string, unknown>;
      sidecars: Record<string, string | { unreadable: string }>;
      extra?: unknown;
    }
  | { type: 'thumbs'; byPackage: Record<string, string | null> };

// Webview -> host. The webview never reads files; it only asks.
export type FromWebview =
  | { type: 'ready' }
  | { type: 'reexport' }
  | { type: 'update' }
  | { type: 'reopenText' }
  | { type: 'openLog' }
  | { type: 'exportReferenced' }
  | { type: 'openAsset'; package: string };
