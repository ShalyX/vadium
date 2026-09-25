import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const file of ['index.html', 'deployment-config.js', 'src/app.js', 'src/style.css']) {
  assert.ok(fs.statSync(path.join(root, file)).size > 0, `${file} is missing or empty`);
}
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(html, /deployment-config\.js/);
assert.match(html, /src\/app\.js/);
assert.match(html, /src\/style\.css/);
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
assert.match(app, /window\.VADIUM_CONFIG/);
assert.match(app, /\.\.\/vendor\/ethers\.min\.js/);
assert.doesNotMatch(app, /https:\/\/cdn\./);
assert.doesNotMatch(app, /PRIVATE_KEY|API_SECRET|PASSPHRASE/);
console.log('Static web build verified.');
