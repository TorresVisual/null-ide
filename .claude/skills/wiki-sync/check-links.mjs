// Checks docs/wiki/*.md: every [text](Page) / [text](Page#anchor) points at an existing
// page and heading, and every page is reachable from _Sidebar.md. Prints "ok" or the problems.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = "docs/wiki";
const pages = Object.fromEntries(
  readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => [f.slice(0, -3), readFileSync(join(dir, f), "utf8")]),
);
// GitHub heading slug: lowercase, drop punctuation except hyphen/space, spaces to hyphens.
const slug = (h) => h.toLowerCase().replace(/[^\w\- ]/g, "").replace(/ /g, "-");
const anchors = (md) => new Set([...md.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => slug(m[1])));

const problems = [];
const linked = new Set();
for (const [name, md] of Object.entries(pages)) {
  for (const [, target] of md.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:)/.test(target)) continue;
    const [page, anchor] = target.split("#");
    const to = page || name;
    if (!(to in pages)) problems.push(`${name}: no page "${to}" (${target})`);
    else {
      if (name === "_Sidebar") linked.add(to);
      if (anchor && !anchors(pages[to]).has(anchor)) problems.push(`${name}: no heading "#${anchor}" in ${to}`);
    }
  }
}
for (const name of Object.keys(pages)) {
  if (name !== "_Sidebar" && !linked.has(name) && name !== "Home") problems.push(`${name}: not linked from _Sidebar`);
}
console.log(problems.length ? problems.join("\n") : "ok");
process.exitCode = problems.length ? 1 : 0;
