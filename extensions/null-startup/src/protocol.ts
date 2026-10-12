'use strict';

// Types only, shared by the host (via `/// <reference path>`) and the webview bundle.
// No imports/exports: this file is a global script (module: none).

type BaselineKind = 'previous' | 'median' | 'none';

interface DeltaVM {
  id: string;
  label: string;
  baseMs?: number;
  currentMs?: number;
  /** current − base; undefined when either side is missing. */
  deltaMs?: number;
  regression: boolean;
}

interface ComparisonVM {
  baseLabel: string;
  headline: DeltaVM;
  phases: DeltaVM[];
  extensions: DeltaVM[];
}
