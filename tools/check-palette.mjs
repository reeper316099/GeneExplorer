// Verifies the design tokens: WCAG contrast for text pairs (light and dark) and colour-vision-deficiency separation of the
// categorical palette and the pLDDT scale (Machado et al. 2009 simulation matrices, CIE76 delta-E in Lab).
// Run: node tools/check-palette.mjs
import { readFileSync } from 'node:fs';

const css = readFileSync('src/styles/tokens.css', 'utf8');
/** Reads the custom properties declared in the first block that matches `selector`. */
function vars(selectorRe) {
  const m = selectorRe.exec(css);
  const out = {};
  for (const [, k, v] of m[1].matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[k] = v.trim();
  return out;
}
const light = vars(/:root\s*\{([^}]*)\}/);
const dark = { ...light, ...vars(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/) };

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const contrast = (a, b) => {
  const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

let failed = 0;
function checkPairs(name, t) {
  const pairs = [
    ['text', 'bg'],
    ['text', 'surface'],
    ['text', 'surface-2'],
    ['text-muted', 'bg'],
    ['text-muted', 'surface'],
    ['text-muted', 'surface-2'],
    ['accent', 'surface'],
    ['accent', 'bg'],
    ['accent-contrast', 'accent'],
    ['warn-text', 'warn-bg'],
    ['bad-text', 'bad-bg'],
    ['accent', 'info-bg'],
    ['highlight', 'surface'],
    ['ok', 'surface'],
  ];
  for (const [fg, bg] of pairs) {
    const c = contrast(t[fg], t[bg]);
    const ok = c >= 4.5;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name.padEnd(5)} ${fg} on ${bg}: ${c.toFixed(2)}:1`);
  }
}
checkPairs('light', light);
checkPairs('dark', dark);

// ---- colour-vision simulation
const M = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};
const toLab = (rgbLin) => {
  const [r, g, b] = rgbLin;
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};
const simulate = (h, m) => {
  const l = hex(h).map(lin);
  const s = m.map((row) => Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2])));
  return toLab(s);
};
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function separation(name, colors, minRequired) {
  for (const kind of ['normal', 'protan', 'deutan', 'tritan']) {
    let min = Infinity;
    let pair = '';
    const labs = colors.map(([n, h]) => [
      n,
      kind === 'normal' ? toLab(hex(h).map(lin)) : simulate(h, M[kind]),
    ]);
    for (let i = 0; i < labs.length; i++)
      for (let j = i + 1; j < labs.length; j++) {
        const d = dE(labs[i][1], labs[j][1]);
        if (d < min) {
          min = d;
          pair = `${labs[i][0]} vs ${labs[j][0]}`;
        }
      }
    const ok = min >= minRequired;
    console.log(
      `${ok ? 'PASS' : 'NOTE'} ${name} under ${kind}: min deltaE ${min.toFixed(1)} (${pair}), required ${minRequired}`,
    );
  }
}
const cats = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => [`cat-${i}`, light[`cat-${i}`]]);
const plddt = ['very-high', 'confident', 'low', 'very-low'].map((k) => [`plddt-${k}`, light[`plddt-${k}`]]);
separation('categorical palette', cats, 12);
separation('pLDDT scale', plddt, 20);
console.log(
  '\nNote: categories are always also separated by text labels, patterns and legends (colour is never the only signal).',
);
process.exitCode = failed ? 1 : 0;
