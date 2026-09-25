import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './verify-web.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'public');

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.join(output, 'src'), { recursive: true });
for (const file of ['index.html', 'deployment-config.js']) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
for (const file of ['app.js', 'style.css']) {
  fs.copyFileSync(path.join(root, 'src', file), path.join(output, 'src', file));
}
console.log('Built public/ with browser-only Vadium assets.');
