import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './verify-web.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'public');

if (path.resolve(output) !== path.resolve(root, 'public') || path.dirname(output) !== root) {
  throw new Error('Build output must stay inside the Vadium workspace.');
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.join(output, 'src'), { recursive: true });
fs.mkdirSync(path.join(output, 'vendor'), { recursive: true });
for (const file of ['index.html', 'deployment-config.js']) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
for (const file of ['app.js', 'style.css']) {
  fs.copyFileSync(path.join(root, 'src', file), path.join(output, 'src', file));
}
fs.copyFileSync(path.join(root, 'node_modules/ethers/dist/ethers.min.js'), path.join(output, 'vendor/ethers.min.js'));
console.log('Built public/ with browser-only Vadium assets.');
