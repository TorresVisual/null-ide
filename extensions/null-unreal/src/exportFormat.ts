// The contract between the CLI and engine/export_asset.py: the request, the manifest and one export file.
export const SCHEMA = 1;

export type Kind = 'material' | 'material-instance' | 'texture' | 'skeletal-mesh' | 'skeleton' | 'generic';
const KINDS: Kind[] = ['material', 'material-instance', 'texture', 'skeletal-mesh', 'skeleton', 'generic'];

// What makes a cache entry valid: all four must match the source file and the tool.
export interface Header { schema: number; engineVersion: string; sourceMtime: number; sourceSize: number }

export interface ExportDoc extends Header {
  package: string;
  kind: Kind;
  class: string;
  references: { dependencies: string[] };
  data: Record<string, unknown>;
  // Values are a file name beside the JSON, or {unreadable: reason}.
  sidecars: Record<string, string | { unreadable: string }>;
}

export interface RequestAsset { package: string; sourceMtime: number; sourceSize: number }
export interface Request { schema: number; engineVersion: string; outputDir: string; manifest: string; assets: RequestAsset[] }

export type AssetStatus = { status: 'exported' } | { status: 'failed'; error: string };
export type Manifest = Record<string, AssetStatus>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// Anything that does not look like a current export is a cache miss, never an error.
export function parseExport(text: string): ExportDoc | undefined {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(j) || !isObject(j.references) || !isObject(j.data) || !isObject(j.sidecars)) return undefined;
  if (typeof j.schema !== 'number' || typeof j.engineVersion !== 'string') return undefined;
  if (typeof j.sourceMtime !== 'number' || typeof j.sourceSize !== 'number') return undefined;
  if (typeof j.package !== 'string' || typeof j.class !== 'string') return undefined;
  if (!KINDS.includes(j.kind as Kind) || !Array.isArray(j.references.dependencies)) return undefined;
  return j as unknown as ExportDoc;
}

export function parseManifest(text: string): Manifest | undefined {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(j) || !isObject(j.assets)) return undefined;
  const out: Manifest = {};
  for (const [pkg, s] of Object.entries(j.assets)) {
    if (!isObject(s)) return undefined;
    if (s.status === 'exported') out[pkg] = { status: 'exported' };
    else if (s.status === 'failed') out[pkg] = { status: 'failed', error: String(s.error ?? 'unknown error') };
    else return undefined;
  }
  return out;
}

// One line for the CLI: what the asset is, in a few words.
export function summarize(doc: ExportDoc): string {
  const d = doc.data;
  const n = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  switch (doc.kind) {
    case 'material':
      return `Material, ${n(d.expressions)} expressions, ${n(d.parameters)} parameters`;
    case 'material-instance':
      return `Material instance of ${d.parent ?? '?'}`;
    case 'texture':
      return `Texture ${d.width}x${d.height}, ${d.compression ?? '?'}`;
    case 'skeletal-mesh':
      return `Skeletal mesh, ${n(d.bones)} bones, ${n(d.lods)} LODs`;
    case 'skeleton':
      return `Skeleton, ${n(d.bones)} bones`;
    case 'generic':
      return `${doc.class} (generic export)`;
  }
}
