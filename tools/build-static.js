// Assembles the publishable static site into dist/. Runtime files only: the
// server, tests, tools and docs stay out of the upload.
import { rmSync, mkdirSync, cpSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

cpSync(path.join(root, 'index.html'), path.join(out, 'index.html'));
cpSync(path.join(root, 'src'), path.join(out, 'src'), { recursive: true });
cpSync(path.join(root, 'data'), path.join(out, 'data'), { recursive: true });

// Nudge writes site.design.css at the site root; include it if it exists.
const designCss = path.join(root, 'site.design.css');
try { cpSync(designCss, path.join(out, 'site.design.css')); } catch { /* not created yet */ }

writeFileSync(path.join(out, '.nojekyll'), '');
console.log('static site →', path.relative(root, out));
