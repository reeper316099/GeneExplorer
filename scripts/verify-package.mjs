// Checks a packaged app: test-mode code and fixtures are absent from app.asar. Usage: node scripts/verify-package.mjs <path to app.asar>
import asar from '@electron/asar';
import { existsSync } from 'node:fs';

const FORBIDDEN_STRINGS = [
  'GENEEXPLORER_TEST_MODE',
  'GENEEXPLORER_BACKGROUND',
  'GENEEXPLORER_TEST_SAVE_DIR',
  'GENEEXPLORER_TEST_RATELIMIT',
  'createFixtureFetch',
];
const FORBIDDEN_PATHS = [/(^|\/)tests?\//, /fixtures/, /\.map$/, /(^|\/)scratch\//, /\.env/];

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('usage: node scripts/verify-package.mjs <app.asar>');
  process.exit(2);
}
let bad = 0;
const names = asar.listPackage(file, { isPack: false }).map((n) => n.replaceAll('\\', '/'));
for (const n of names) {
  if (FORBIDDEN_PATHS.some((re) => re.test(n))) {
    console.error(`FAIL forbidden file in package: ${n}`);
    bad++;
  }
}
for (const n of names.filter((x) => /\.(cjs|js|mjs|html|json)$/.test(x))) {
  let text;
  try {
    text = asar.extractFile(file, n.replace(/^\//, '')).toString('utf8');
  } catch {
    continue;
  }
  for (const s of FORBIDDEN_STRINGS) {
    if (text.includes(s)) {
      console.error(`FAIL "${s}" found in ${n}`);
      bad++;
    }
  }
}
console.log(`${names.length} files inspected in ${file}`);
if (bad) process.exit(1);
console.log('PASS: no test-mode strings, fixtures, source maps or test files in the package');
