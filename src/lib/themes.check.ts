// Runnable self-check: node --experimental-strip-types src/lib/themes.check.ts
// Every theme in THEMES has a token block in index.css that defines every token the light theme defines, and
// its text/background pairs meet WCAG AA (4.5:1).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { THEMES, resolveTheme } from "./themes.ts";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// theme id -> declarations, merged across every block whose selector names that theme
const themes = new Map<string, Map<string, string>>();
for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  for (const [, id] of selector.matchAll(/\[data-theme="([\w-]+)"\]/g)) {
    const decls = themes.get(id) ?? new Map<string, string>();
    for (const [, prop, value] of body.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) decls.set(prop, value.trim());
    themes.set(id, decls);
  }
}

// "Follow system" on a dark OS without a native answer uses the media-query copy of the dark tokens.
const systemDark = [...css.matchAll(/:root:not\(\[data-theme\]\)\s*\{([^{}]*)\}/g)].map((m) => m[1]);
assert.equal(systemDark.length, 1, "index.css needs one `:root:not([data-theme])` dark fallback block");
const norm = (body: string) => body.replace(/\s+/g, " ").trim();
assert.equal(
  norm(systemDark[0]),
  norm(css.match(/:root\[data-theme="dark"\]\s*\{([^{}]*)\}/)![1]),
  "system fallback differs from dark",
);

const light = themes.get("light");
assert.ok(light && light.size > 10, "index.css has no light token block");
assert.ok(light.has("color-scheme"), "light block sets color-scheme");

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  assert.ok(m, `not a hex colour: ${hex}`);
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
assert.equal(Math.round(contrast("#000", "#fff")), 21);
assert.equal(contrast("#777", "#777"), 1);

const PAIRS = [
  ["--fg", "--bg"],
  ["--fg", "--bg-elev"],
  ["--accent-fg", "--accent"],
  ["--danger-fg", "--danger"],
  // the SQL editor paints on --bg-elev
  ["--syn-keyword", "--bg-elev"],
  ["--syn-string", "--bg-elev"],
  ["--syn-number", "--bg-elev"],
  ["--syn-type", "--bg-elev"],
] as const;

for (const { id } of THEMES) {
  if (id === "system") continue;
  const decls = themes.get(id);
  assert.ok(decls, `theme "${id}" has no :root[data-theme="${id}"] block in index.css`);
  const missing: string[] = [...light.keys()].filter((k) => !decls.has(k));
  assert.deepEqual(missing, [], `theme "${id}" is missing tokens`);
  for (const [fg, bg] of PAIRS) {
    const ratio = contrast(decls.get(fg)!, decls.get(bg)!);
    assert.ok(ratio >= 4.5, `theme "${id}": ${fg} on ${bg} is ${ratio.toFixed(2)}:1, below 4.5:1`);
  }
}
const orphans = [...themes.keys()].filter((id) => !THEMES.some((t) => t.id === id));
assert.deepEqual(orphans, [], "index.css defines themes missing from THEMES");

assert.equal(resolveTheme("dark"), "dark");
assert.equal(resolveTheme("nord"), "nord");
assert.equal(resolveTheme("no-such-theme"), "system");
assert.equal(resolveTheme(null), "system");
assert.equal(resolveTheme(undefined), "system");
console.log("themes.check ok");
