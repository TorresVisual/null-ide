// A syntax marker stays hidden unless a selection range touches the node that owns it.
export function touches(from, to, ranges) {
	for (const r of ranges) if (r.from <= to && r.to >= from) return true;
	return false;
}
