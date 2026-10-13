'use strict';

export interface Feature {
  /** `<extensionId>/<id>`, unique across all extensions. */
  key: string;
  label: string;
  command: string;
  category: string;
  icon: string;
  description?: string;
  order: number;
}

export interface FeatureCategory {
  id: string;
  title: string;
  features: Feature[];
}

export interface ManifestInput {
  extensionId: string;
  packageJSON: unknown;
}

const CATEGORIES = [
  { id: 'develop', title: 'Develop' },
  { id: 'insights', title: 'Insights' },
  { id: 'account', title: 'Account & Sync' },
  { id: 'setup', title: 'Setup' },
];
const DEFAULT_ICON = 'symbol-misc';
const DEFAULT_ORDER = 100;
const PUBLISHER_PREFIX = 'null.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseEntry(extensionId: string, raw: unknown): Feature | undefined {
  if (!isRecord(raw)) { return undefined; }
  const id = text(raw.id);
  const label = text(raw.label);
  const command = text(raw.command);
  const category = text(raw.category);
  if (!id || !label || !command || !category) { return undefined; }
  const order = typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : DEFAULT_ORDER;
  return {
    key: `${extensionId}/${id}`,
    label,
    command,
    category,
    icon: text(raw.icon) ?? DEFAULT_ICON,
    description: text(raw.description),
    order,
  };
}

/**
 * Collects `nullWorkspace.features` from the manifests of `null.*` extensions into ordered
 * categories. Bad input is skipped (and reported through `warn`), never thrown.
 */
export function collectFeatures(
  manifests: ManifestInput[],
  warn: (message: string) => void = () => undefined,
): FeatureCategory[] {
  const seen = new Set<string>();
  const byCategory = new Map<string, Feature[]>();

  for (const { extensionId, packageJSON } of manifests) {
    if (!extensionId.toLowerCase().startsWith(PUBLISHER_PREFIX) || !isRecord(packageJSON)) { continue; }
    const block = packageJSON.nullWorkspace;
    if (block === undefined) { continue; }
    const list = isRecord(block) ? block.features : undefined;
    if (!Array.isArray(list)) {
      warn(`${extensionId}: nullWorkspace.features must be an array`);
      continue;
    }
    for (const raw of list) {
      const feature = parseEntry(extensionId, raw);
      if (!feature) {
        warn(`${extensionId}: skipped a malformed nullWorkspace feature`);
        continue;
      }
      if (seen.has(feature.key)) {
        warn(`${extensionId}: duplicate feature ${feature.key}`);
        continue;
      }
      seen.add(feature.key);
      const group = byCategory.get(feature.category);
      if (group) { group.push(feature); } else { byCategory.set(feature.category, [feature]); }
    }
  }

  const known = CATEGORIES.map(c => c.id);
  const unknown = [...byCategory.keys()].filter(id => !known.includes(id)).sort();
  const titles = new Map(CATEGORIES.map(c => [c.id, c.title]));
  return [...known, ...unknown]
    .filter(id => byCategory.has(id))
    .map(id => ({
      id,
      title: titles.get(id) ?? id.charAt(0).toUpperCase() + id.slice(1),
      features: byCategory.get(id)!.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)),
    }));
}
