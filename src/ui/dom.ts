// Tiny DOM helpers. Text is always set with textContent / createTextNode, never innerHTML, so data from the
// databases can never be interpreted as markup.
type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

/** Creates an element with attributes (on* functions become listeners) and children (strings become text nodes). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  applyAttrs(e, attrs);
  append(e, children);
  return e;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Creates an SVG element (same attribute rules as h). */
export function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  applyAttrs(e, attrs);
  append(e, children);
  return e;
}

/** Sets attributes on an element; `on<event>` functions are added as listeners, false/undefined are skipped. */
function applyAttrs(e: Element, attrs: Attrs): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, String(v));
  }
}

/** Appends children, converting strings to text nodes and skipping null/false. */
export function append(parent: ParentNode, children: readonly Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

/** Removes all children of a node. */
export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Replaces a node's children. */
export function setChildren(node: Element, ...children: Child[]): void {
  clear(node);
  append(node, children);
}

/** Formats a number with thousands separators (en-US, so coordinates read the same everywhere). */
export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/** Formats a timestamp as local date and time. */
export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** Describes how long ago a time was ("3 days ago"). */
export function ago(ms: number, now = Date.now()): string {
  const sec = Math.max(0, Math.round((now - ms) / 1000));
  if (sec < 60) return 'just now';
  const units: [number, string][] = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [size, name] of units) {
    if (sec >= size) {
      const n = Math.floor(sec / size);
      return `${n} ${name}${n === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}
