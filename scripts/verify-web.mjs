import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const file of ['review.html', 'favicon.svg', 'src/review.css']) {
  assert.ok(fs.statSync(path.join(root, file)).size > 0, `${file} is missing or empty`);
}
const review = fs.readFileSync(path.join(root, 'review.html'), 'utf8');
assert.match(review, /LOCAL TEST FIXTURES/);
assert.match(review, /Public borrowing is unavailable/);
assert.match(review, /credit-relay-evidence\.json/);
for (const file of ['index.html', 'app.html', 'assets.html', 'deployment-config.js', 'src/app.js', 'src/assets.js', 'src/assets.css', 'src/landing.css', 'src/markets.js', 'src/style.css']) {
  assert.ok(fs.statSync(path.join(root, file)).size > 0, `${file} is missing or empty`);
}
const landing = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(landing, /href="\/app\.html"/);
assert.match(landing, /src\/landing\.css/);
const desk = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
assert.match(desk, /src\/pilot\.js/);
assert.match(desk, /id="positionTitle"/);
assert.match(desk, /id="historyRows"/);
const html = fs.readFileSync(path.join(root, 'testnet.html'), 'utf8');
assert.match(html, /deployment-config\.js/);
assert.match(html, /src\/app\.js/);
assert.match(html, /src\/style\.css/);
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
assert.match(app, /window\.VADIUM_CONFIG/);
assert.match(app, /from '\.\/markets\.js'/);
assert.match(app, /\.\.\/vendor\/ethers\.min\.js/);
const markets = fs.readFileSync(path.join(root, 'src/markets.js'), 'utf8');
assert.match(markets, /0xa8ddb5cd96b5222afe198316e9a57caa642850d5/);
assert.match(markets, /0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171/);
assert.match(markets, /0x4ae46a509F6b1D9056937BA4500cb143933D2dc8/);
assert.doesNotMatch(app, /https:\/\/cdn\./);
assert.doesNotMatch(app, /PRIVATE_KEY|API_SECRET|PASSPHRASE/);
console.log('Static web build verified.');
