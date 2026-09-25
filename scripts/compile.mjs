import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const here = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.resolve(here, '../contracts');
const sources = Object.fromEntries(
  fs.readdirSync(contractsDir).map((name) => [name, { content: fs.readFileSync(path.join(contractsDir, name), 'utf8') }]),
);
const output = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources,
  settings: {
    evmVersion: 'paris',
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
})));
for (const issue of output.errors ?? []) console.log(issue.formattedMessage);
if ((output.errors ?? []).some((issue) => issue.severity === 'error')) process.exit(1);
console.log(`Compiled ${Object.values(output.contracts).reduce((sum, file) => sum + Object.keys(file).length, 0)} contracts.`);
