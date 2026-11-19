// Small pure helpers shared by the SVG diagrams.

/** Picks a "nice" scale-bar length (1, 2 or 5 times a power of ten) that is at most `max`. */
export function niceLength(max: number): number {
  if (max <= 0) return 1;
  let pow = 10 ** Math.floor(Math.log10(max));
  // Floating-point log10 can round up at exact powers of ten (e.g. 999999999.99999 -> 9), so step back if we overshot.
  if (pow > max) pow /= 10;
  for (const m of [5, 2, 1]) if (m * pow <= max) return m * pow;
  return pow;
}

/** Formats a length in base pairs with a sensible unit (bp, kb, Mb). */
export function fmtBp(bp: number): string {
  if (bp >= 1_000_000) return `${+(bp / 1_000_000).toFixed(2)} Mb`;
  if (bp >= 1_000) return `${+(bp / 1_000).toFixed(1)} kb`;
  return `${bp} bp`;
}

/** Assigns each interval to the first row where it does not overlap an earlier one (greedy packing). */
export function packRows(items: readonly { start: number; end: number }[]): number[] {
  const rowEnds: number[] = [];
  const order = items.map((_, i) => i).sort((a, b) => (items[a]?.start ?? 0) - (items[b]?.start ?? 0));
  const rows: number[] = new Array<number>(items.length).fill(0);
  for (const i of order) {
    const it = items[i];
    if (!it) continue;
    let r = rowEnds.findIndex((e) => e < it.start);
    if (r < 0) {
      r = rowEnds.length;
      rowEnds.push(it.end);
    } else rowEnds[r] = it.end;
    rows[i] = r;
  }
  return rows;
}

/** Resolves var(--name) references in an SVG's attributes to concrete colours so it can be drawn standalone (PNG export). */
export function inlineCssVars(svg: SVGElement): SVGElement {
  const clone = svg.cloneNode(true) as SVGElement;
  const root = getComputedStyle(document.documentElement);
  const fix = (v: string): string =>
    v.replace(/var\((--[a-z0-9-]+)\)/gi, (_m, name: string) => root.getPropertyValue(name).trim() || '#000');
  const all = [clone, ...Array.from(clone.querySelectorAll('*'))];
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.value.includes('var(')) el.setAttribute(attr.name, fix(attr.value));
    }
  }
  return clone;
}
