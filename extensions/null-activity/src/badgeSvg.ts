'use strict';

// ponytail: width is estimated from the character count (Verdana 11px averages ~6.6px), not measured.
// Tune CHAR_PX if labels look cramped; add a per-character width table only if that is not enough.
const CHAR_PX = 6.6;
const PAD = 10;
const HEIGHT = 20;

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]);
const segmentWidth = (text: string) => Math.round(text.length * CHAR_PX) + PAD;

/** A flat, shields.io-style two-segment badge: dark label, coloured value. */
export function renderBadge(label: string, value: string, color: string): string {
  const lw = segmentWidth(label);
  const vw = segmentWidth(value);
  const w = lw + vw;
  const l = escapeXml(label);
  const v = escapeXml(value);
  const title = `${l}: ${v}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${HEIGHT}" role="img" aria-label="${title}">` +
    `<title>${title}</title>` +
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>` +
    `<clipPath id="r"><rect width="${w}" height="${HEIGHT}" rx="3" fill="#fff"/></clipPath>` +
    `<g clip-path="url(#r)"><rect width="${lw}" height="${HEIGHT}" fill="#555"/>` +
    `<rect x="${lw}" width="${vw}" height="${HEIGHT}" fill="${escapeXml(color)}"/>` +
    `<rect width="${w}" height="${HEIGHT}" fill="url(#s)"/></g>` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">` +
    `<text x="${lw / 2}" y="14">${l}</text><text x="${lw + vw / 2}" y="14">${v}</text></g></svg>`
  );
}
