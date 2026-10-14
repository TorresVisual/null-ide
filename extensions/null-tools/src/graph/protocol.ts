// Types shared by the extension host and the Commit Graph webview. No imports or exports: this is a global
// script so the webview bundle (module: none) can compile it; host files pull it in with a triple-slash reference.

interface GraphRefLabel {
  name: string;
  kind: 'head' | 'branch' | 'remote' | 'tag' | 'stash';
  /** The checked-out branch, or the detached HEAD label. */
  current?: boolean;
}

/** One drawn segment inside a 24 px row. pass: lane runs through; in: top of the row -> node; out: node -> bottom. */
interface GraphEdge {
  kind: 'pass' | 'in' | 'out';
  from: number;
  to: number;
  /** Lane index modulo the palette size; the webview maps it to a --vscode-charts-* variable. */
  color: number;
}

interface GraphRow {
  sha: string;
  parents: string[];
  lane: number;
  laneCount: number;
  edges: GraphEdge[];
  refs: GraphRefLabel[];
  subject: string;
  author: string;
  /** Unix seconds. */
  time: number;
}

interface GraphDetail {
  sha: string;
  parents: string[];
  author: string;
  authorEmail: string;
  authorTime: number;
  committer: string;
  committerEmail: string;
  committerTime: number;
  message: string;
}

interface GraphFile {
  /** Single git status letter: A M D R C T U. */
  status: string;
  path: string;
  oldPath?: string;
}

type GraphOperationKind = 'cherry-pick' | 'revert' | 'merge' | 'rebase';
interface GraphInProgress { kind: GraphOperationKind }
type GraphUnavailableReason = 'no-folder' | 'remote' | 'untrusted' | 'not-a-repo' | 'no-git';

type GraphHostToWebview =
  | { type: 'rows'; rows: GraphRow[]; hasMore: boolean; reset: boolean }
  | { type: 'detail'; detail: GraphDetail }
  | { type: 'files'; sha: string; files: GraphFile[] }
  | { type: 'state'; inProgress: GraphInProgress | null }
  | { type: 'focus'; sha: string }
  | { type: 'loadError'; message: string; retry: 'refresh' | 'loadMore' }
  | { type: 'unavailable'; reason: GraphUnavailableReason };

type GraphWebviewToHost =
  | { type: 'ready' }
  | { type: 'loadMore' }
  | { type: 'refresh' }
  | { type: 'select'; sha: string }
  | { type: 'goto'; sha: string }
  | { type: 'openDiff'; sha: string; file: string }
  | { type: 'banner'; action: 'continue' | 'skip' | 'abort' }
  | { type: 'manageTrust' };
