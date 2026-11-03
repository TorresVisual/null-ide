// Bone hierarchy for the skeleton view. Pure.

export interface BoneNode { name: string; children: BoneNode[] }

// A parent that is not a bone in the list (or is unreadable, or is the bone itself) makes the bone a root.
// Cycles terminate: a bone is placed once, and a cycle with no root is opened at its first bone.
export function boneTree(bones: { name: string; parent: unknown }[]): BoneNode[] {
  const names = new Set(bones.map((b) => b.name));
  const parentOf = new Map<string, string | undefined>();
  for (const b of bones) {
    const p = b.parent;
    parentOf.set(b.name, typeof p === 'string' && names.has(p) && p !== b.name ? p : undefined);
  }
  const kids = new Map<string, string[]>();
  for (const b of bones) {
    const p = parentOf.get(b.name);
    if (p !== undefined) kids.set(p, [...(kids.get(p) ?? []), b.name]);
  }

  const placed = new Set<string>();
  const build = (name: string): BoneNode => {
    placed.add(name);
    const open = (kids.get(name) ?? []).filter((c) => !placed.has(c));
    return { name, children: open.map(build) };
  };

  const roots: BoneNode[] = [];
  for (const b of bones) if (parentOf.get(b.name) === undefined) roots.push(build(b.name));
  for (const b of bones) if (!placed.has(b.name)) roots.push(build(b.name));
  return roots;
}
