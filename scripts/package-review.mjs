import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'release', 'vadium-review');
if (path.relative(root, output) !== path.join('release', 'vadium-review')) throw Error('Unsafe package destination');
const files = new Set(['README.md', 'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json',
  'index.html', 'app.html', 'assets.html', 'pilot.html', 'review.html', 'testnet.html', 'favicon.svg',
  'social-preview.png', 'deployment-config.js', 'private-pilot-config.js', 'vercel.json', '.gitignore']);
const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(item => {
  const file = `${dir}/${item.name}`;
  if (item.isSymbolicLink()) throw Error(`Symlink not allowed: ${file}`);
  return item.isDirectory() ? walk(file) : [file];
});
for (const dir of ['src', 'scripts', 'contracts', 'tests']) for (const file of walk(dir)) files.add(file);
for (const file of ['package-qa.md','review-package.md','demo-script.md','issuer-relay.md','mainnet-release.md','private-mainnet-pilot.md',
  'liquidation-review.md','credit-quality-benchmark.md','credit-pilot.md','oracle-access-status.md','redstone-feasibility.md']) files.add(`docs/${file}`);
for (const file of ['private-pilot.onchain-evidence.json','private-pilot.wrapper-evidence.json','private-pilot.mainnet.json',
  'private-pilot.compiler-input.json','issuer-relay-rehearsal.json','credit-relay-rehearsal.json','credit-pilot.testnet.json',
  'issuer-price-schema-probe.json','issuer-direct-feed-check.json','api3-xlayer-access-check.json','redstone-access-probe.json']) files.add(`deployments/${file}`);
if (fs.existsSync(path.join(root, 'output/playwright'))) {
  for (const file of walk('output/playwright')) if (/\.png$/.test(file)) files.add(file);
}
// Match literal credentials, never print their contents. Runtime environment references are allowed.
const forbidden = /(?:PRIVATE_KEY|API_SECRET|SECRET_KEY|mnemonic)\s*[=:]\s*["'](?:0x)?[A-Za-z0-9 /+]{24,}["']|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}/i;
for (const file of files) {
  if (/\.env|\.local\.json$|\.lock$/.test(file)) throw Error(`Local file excluded: ${file}`);
  if (!file.endsWith('.png') && forbidden.test(fs.readFileSync(path.join(root,file),'utf8'))) throw Error(`Possible literal credential in ${file}`);
}
fs.rmSync(output, { recursive: true, force: true });
const entries = [];
for (const file of [...files].sort()) {
  const bytes = fs.readFileSync(path.join(root, file));
  const target = path.join(output, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  entries.push({ path: file, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
}
const sourceCommit = process.env.VADIUM_SOURCE_COMMIT || execFileSync('git', ['rev-parse','HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw Error('Invalid source commit');
const manifest = { project: 'Vadium', createdAt: new Date().toISOString(), sourceCommit,
  includesUncommittedWork: true, deployedByThisCommand: false, submitted: false,
  credentialScan: 'No matching literal credentials in the curated package; heuristic scan, not a security audit.', files: entries };
fs.writeFileSync(path.join(output, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Packaged ${entries.length} files with SHA-256 hashes at ${output}`);
