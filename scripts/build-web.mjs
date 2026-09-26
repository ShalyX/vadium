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
// The repository-root preview used during development serves /vendor directly.
// Keep it in sync with the production bundle so both entry points execute.
fs.mkdirSync(path.join(root, 'vendor'), { recursive: true });
for (const file of ['social-preview.png', 'favicon.svg', 'review.html', 'index.html', 'app.html', 'testnet.html', 'assets.html', 'pilot.html', 'private-pilot-config.js', 'deployment-config.js']) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
for (const file of ['app.js', 'pilot.js', 'pilot-state.js', 'pilot.css', 'review.css', 'assets.js', 'assets.css', 'coverage.js', 'repayment.js', 'wallet.js', 'landing.css', 'markets.js', 'style.css']) {
  fs.copyFileSync(path.join(root, 'src', file), path.join(output, 'src', file));
}
fs.copyFileSync(path.join(root, 'node_modules/ethers/dist/ethers.min.js'), path.join(output, 'vendor/ethers.min.js'));
fs.copyFileSync(path.join(root, 'node_modules/ethers/dist/ethers.min.js'), path.join(root, 'vendor/ethers.min.js'));
if (fs.statSync(path.join(root, 'vendor/ethers.min.js')).size !== fs.statSync(path.join(output, 'vendor/ethers.min.js')).size) {
  throw new Error('Preview and production wallet bundles differ.');
}
console.log('Built public/ with browser-only Vadium assets.');

const pilotEvidence = JSON.stringify({ credit: JSON.parse(fs.readFileSync(path.join(root, 'deployments/private-pilot.onchain-evidence.json'), 'utf8')), wrapper: JSON.parse(fs.readFileSync(path.join(root, 'deployments/private-pilot.wrapper-evidence.json'), 'utf8')) }, null, 2);
fs.writeFileSync(path.join(root, 'pilot-evidence.json'), pilotEvidence + '\n');
fs.writeFileSync(path.join(output, 'pilot-evidence.json'), pilotEvidence + '\n');

fs.copyFileSync(path.join(root, 'deployments/credit-relay-rehearsal.json'), path.join(output, 'credit-relay-evidence.json'));
