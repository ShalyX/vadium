import fs from 'node:fs';
import { ethers } from 'ethers';
import solc from 'solc';
import { XLAYER, MARKETS } from '../src/markets.js';

const participant = '0x1DcB045123730e606A88380BCe534332F50332d2';
const market = MARKETS.NVDAx;
const file = 'deployments/private-pilot.mainnet.json';
const deployRequested = process.argv.includes('--deploy');
const provider = new ethers.JsonRpcProvider(XLAYER.rpcUrl, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
try {
  if (Number((await provider.getNetwork()).chainId) !== 196) throw Error('Wrong chain');
  const source = 'https://api.xstocks.fi/api/v2/public/assets/NVDAx';
  const response = await fetch(source, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`Issuer HTTP ${response.status}`);
  const issuer = await response.json();
  const entry = issuer.deployments?.find(x => x.network === 'XLayer');
  if (entry?.address?.toLowerCase() !== market.token || entry?.wrapperAddressV2?.toLowerCase() !== market.wrapper || issuer.isTradingHalted) throw Error('Issuer mismatch or halt');
  const tokenAbi = ['function balanceOf(address) view returns(uint256)', 'function decimals() view returns(uint8)', 'function asset() view returns(address)', 'function convertToAssets(uint256) view returns(uint256)'];
  const wrapper = new ethers.Contract(market.wrapper, tokenAbi, provider);
  const stable = new ethers.Contract(XLAYER.usdg, tokenAbi, provider);
  const token = new ethers.Contract(market.token, tokenAbi, provider);
  if ((await wrapper.asset()).toLowerCase() !== market.token || Number(await stable.decimals()) !== 6) throw Error('Onchain asset mismatch');
  for (const address of [market.token, market.wrapper, XLAYER.usdg]) if (await provider.getCode(address) === '0x') throw Error('Missing code');
  const shareRate = await wrapper.convertToAssets(10n ** await wrapper.decimals());
  if (shareRate === 0n) throw Error('Zero wrapper conversion');
  const keys = fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(x => x.startsWith('DEPLOYER_PRIVATE_KEY=')).map(x => x.slice(21).trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  const signer = new ethers.Wallet(keys.at(-1), provider);
  const balances = { participantOkb: ethers.formatEther(await provider.getBalance(participant)), participantUsdg: ethers.formatUnits(await stable.balanceOf(participant), 6), participantNvda: ethers.formatUnits(await token.balanceOf(participant), await token.decimals()), deployerOkb: ethers.formatEther(await provider.getBalance(signer.address)) };
  const evidence = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { kind: 'PRIVATE_MAINNET_SYNTHETIC_PRICE_PILOT', chainId: 196, participant, stable: XLAYER.usdg, collateral: market.wrapper, underlying: market.token, transactions: [] };
  evidence.preflight = { at: new Date().toISOString(), issuerSource: source, issuerDeployment: entry, shareRate: shareRate.toString(), balances };
  evidence.terms = { testPriceUsd: '100', priceIsMarketData: false, supplyLifetimeUsdg: '0.02', debtCeilingUsdg: '0.01', plannedDrawUsdg: '0.005', plannedWrapNvda: '0.001', nominalAprBps: 100, borrowLtvBps: 2500, liquidationLtvBps: 5000, durationDays: 7 };
  const save = () => fs.writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n');
  save();
  console.log(JSON.stringify({ mode: deployRequested ? 'deploy' : 'preflight', ...balances, existingPool: evidence.pool ?? null }));
  if (!deployRequested) process.exitCode = 0;
  else {
    const sources = Object.fromEntries(fs.readdirSync('contracts').map(name => [name, { content: fs.readFileSync(`contracts/${name}`, 'utf8') }]));
    const input = { language: 'Solidity', sources, settings: { evmVersion: 'paris', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
    const out = JSON.parse(solc.compile(JSON.stringify(input)));
    if (out.errors?.some(x => x.severity === 'error')) throw Error(out.errors.map(x => x.formattedMessage).join('\n'));
    fs.writeFileSync('deployments/private-pilot.compiler-input.json', JSON.stringify(input, null, 2));
    evidence.compiler = solc.version();
    evidence.sourceHash = ethers.id(JSON.stringify(input));
    async function deploy(name, args, key) {
      const artifact = out.contracts['VadiumPrivatePilot.sol'][name];
      if (evidence[key]) {
        if (await provider.getCode(evidence[key]) === '0x') throw Error(`Recorded ${key} has no code`);
        return;
      }
      if (evidence.pending) {
        const receipt = await provider.getTransactionReceipt(evidence.pending.hash);
        if (!receipt || receipt.status !== 1 || evidence.pending.key !== key) throw Error('Pending deployment requires receipt reconciliation');
        evidence[key] = receipt.contractAddress;
        evidence.transactions.push({ ...evidence.pending, block: receipt.blockNumber, status: receipt.status, gasUsed: receipt.gasUsed.toString() });
        delete evidence.pending; save(); return;
      }
      const contract = await new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy(...args);
      const tx = contract.deploymentTransaction();
      evidence.pending = { key, hash: tx.hash, args }; save();
      const receipt = await tx.wait();
      if (receipt.status !== 1) throw Error('Deployment reverted');
      evidence[key] = receipt.contractAddress;
      evidence.transactions.push({ ...evidence.pending, block: receipt.blockNumber, status: receipt.status, gasUsed: receipt.gasUsed.toString() });
      delete evidence.pending; save();
      console.log(`${name}: ${receipt.contractAddress}`);
    }
    await deploy('PrivatePilotPrice', [market.wrapper, ethers.parseEther('100').toString()], 'oracle');
    await deploy('VadiumPrivatePilot', [XLAYER.usdg, market.wrapper, evidence.oracle, market.token, participant], 'pool');
    const pool = new ethers.Contract(evidence.pool, out.contracts['VadiumPrivatePilot.sol'].VadiumPrivatePilot.abi, provider);
    if ((await pool.participant()).toLowerCase() !== participant.toLowerCase() || await pool.debtCeiling() !== 10000n || await pool.supplyCap() !== 20000n) throw Error('Deployed restrictions mismatch');
    evidence.expiresAt = Number(await pool.expiresAt());
    evidence.runtimeCodeHash = ethers.keccak256(await provider.getCode(evidence.pool));
    evidence.status = 'deployed-awaiting-participant-transactions'; save();
    fs.writeFileSync('private-pilot-config.js', `export default ${JSON.stringify({ ...evidence, abi: out.contracts['VadiumPrivatePilot.sol'].VadiumPrivatePilot.abi }, null, 2)};\n`);
  }
} finally { provider.destroy(); }
