import { ethers } from '/vendor/ethers.min.js';
import config from '/private-pilot-config.js';
import { injectedWallet, switchWalletNetwork, assertWalletSession, watchWallet } from './wallet.js';
import { XLAYER } from './markets.js';
import { pilotActions, pilotPosition } from './pilot-state.js';

const $ = id => document.getElementById(id);
const buttons = [...document.querySelectorAll('[data-action]')];
const key = `vadium-private-pilot:${config.pool || 'pending'}`;
let log;
try { log = JSON.parse(localStorage.getItem(key) || '[]'); if (!Array.isArray(log)) log = []; } catch { log = []; }
let wallet, account, provider, signer, pool, stable, wrapper, token, state, busy = false, unwatch;
let recordedEvidence;
const tokenAbi = ['function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)', 'function approve(address,uint256) returns(bool)', 'function decimals() view returns(uint8)', 'function asset() view returns(address)', 'function previewDeposit(uint256) view returns(uint256)', 'function deposit(uint256,address) returns(uint256)', 'function redeem(uint256,address,address) returns(uint256)'];
const status = text => { $('status').textContent = text; };
function save() { localStorage.setItem(key, JSON.stringify(log)); renderLog(); }
function renderLog() {
  $('evidence').replaceChildren();
  for (const item of log) {
    const li = document.createElement('li');
    li.textContent = `${item.label} · ${item.status} `;
    if (item.hash && /^0x[0-9a-f]{64}$/i.test(item.hash)) { const link = document.createElement('a'); link.href = `${XLAYER.explorer}/tx/${item.hash}`; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = `${item.hash.slice(0,12)}…`; li.append(link); }
    $('evidence').append(li);
  }
}
function controls() {
  const available = pilotActions(state);
  for (const button of buttons) {
    const enabled = available[button.dataset.action];
    button.disabled = busy || !account || !enabled;
  }
  $('connect').disabled = busy;
  $('refresh').disabled = busy || !account;
  const position = pilotPosition(state);
  $('positionTitle').textContent = position.title;
  $('positionCopy').textContent = position.description;
}
async function refresh() {
  await assertWalletSession(wallet, account, 196);
  const blockTag = await provider.getBlockNumber();
  const opt = { blockTag };
  // Sequential reads avoid public RPC batch omissions.
  state = { balance: await stable.balanceOf(account, opt), debt: await pool.debtOf(account, opt), collateral: await pool.collateralOf(account, opt), lender: await pool.liquidityShares(account, opt), wrapped: await wrapper.balanceOf(account, opt), raw: await token.balanceOf(account, opt), supplied: await pool.suppliedLifetime(opt), capacity: await pool.borrowCapacity(account, opt), cash: await stable.balanceOf(config.pool, opt), wrapAmount: ethers.parseUnits('0.001', Number(await token.decimals(opt))), wrapperDecimals: Number(await wrapper.decimals(opt)), active: Number((await provider.getBlock(blockTag)).timestamp) <= config.expiresAt && !(await pool.borrowPaused(opt)) && !(await pool.supplyPaused(opt)) };
  $('balance').textContent = `${ethers.formatUnits(state.balance,6)} USDG`;
  $('debt').textContent = `${ethers.formatUnits(state.debt,6)} USDG`;
  $('collateral').textContent = ethers.formatUnits(state.collateral,state.wrapperDecimals);
  $('lender').textContent = state.lender.toString();
  log.push({ label: 'Balance snapshot', status: 'read', block: blockTag, at: new Date().toISOString(), balances: Object.fromEntries(Object.entries(state).map(([k,v]) => [k,typeof v === 'bigint' ? v.toString() : v])) }); save(); controls();
}
async function send(label, contract, method, args) {
  await assertWalletSession(wallet, account, 196);
  status(`${label}: review the transaction in your wallet.`);
  const tx = await contract[method](...args);
  const item = { label, hash: tx.hash, status: 'submitted', from: account, to: tx.to, data: tx.data, value: tx.value.toString(), at: new Date().toISOString() };
  log.push(item); save(); status(`${label}: waiting for confirmation…`);
  let receipt;
  try { receipt = await tx.wait(); } catch (error) { item.status = 'unconfirmed-or-failed'; save(); throw error; }
  item.status = receipt.status === 1 ? 'confirmed' : 'reverted'; item.block = receipt.blockNumber; item.gasUsed = receipt.gasUsed.toString(); item.logs = receipt.logs.map(x => ({ address: x.address, topics: [...x.topics], data: x.data })); save();
  if (receipt.status !== 1) throw Error('Transaction reverted');
}
async function approve(contract, spender, amount, label) {
  const allowance = await contract.allowance(account, spender);
  if (allowance >= amount) return;
  if (allowance > 0n) await send(`Clear ${label} allowance`, contract, 'approve', [spender, 0]);
  await send(`Approve ${label}`, contract, 'approve', [spender, amount]);
}
async function action(name) {
  if (busy) return; busy = true; controls();
  try {
    await refresh();
    if (!pilotActions(state)[name]) throw Error('This step is unavailable for the current position. Balances have been refreshed.');
    if (name === 'supply') { if (state.supplied !== 0n || state.balance < 21000n) throw Error('Supply needs 0.021 USDG and an unused pilot.'); await approve(stable, config.pool, 20000n, '0.02 USDG'); await send('Supply',pool,'supply',[20000n]); }
    if (name === 'wrap') { await approve(token,config.collateral,state.wrapAmount,'0.001 NVDAx'); await send('Wrap',wrapper,'deposit',[state.wrapAmount,account]); }
    if (name === 'deposit') { const cap = await wrapper.previewDeposit(state.wrapAmount); const amount = state.wrapped < cap ? state.wrapped : cap; await approve(wrapper,config.pool,amount,'pilot wrapper shares'); await send('Deposit collateral',pool,'depositCollateral',[amount]); }
    if (name === 'borrow') await send('Draw 0.005 USDG',pool,'borrow',[5000n]);
    if (name === 'repay') { const amount = state.debt + 100n; if (state.balance < amount) throw Error('Keep 0.0001 USDG above current debt for the repayment buffer.'); await approve(stable,config.pool,amount,'debt plus 0.0001 USDG buffer'); await send('Repay full debt',pool,'repay',[amount]); await send('Clear remaining USDG approval',stable,'approve',[config.pool,0]); }
    if (name === 'withdraw') await send('Withdraw collateral',pool,'withdrawCollateral',[state.collateral]);
    if (name === 'unwrap') { const cap = await wrapper.previewDeposit(state.wrapAmount); await send('Unwrap',wrapper,'redeem',[state.wrapped < cap ? state.wrapped : cap,account,account]); }
    if (name === 'redeem') await send('Redeem lender shares',pool,'withdrawLiquidity',[state.lender]);
    await refresh(); status('Confirmed and recorded. Balances refreshed.');
  } catch (error) { status(error.shortMessage || error.message || 'Wallet action failed.'); }
  finally { busy = false; controls(); }
}
$('connect').onclick = async () => {
  busy = true; controls();
  status('Connecting to your wallet…');
  try {
    if (!config.pool) throw Error('Private pilot has not been deployed.');
    wallet = injectedWallet(window); if (!wallet) throw Error('Open this page in your OKX wallet browser or enable the wallet extension.');
    await wallet.request({ method: 'eth_requestAccounts' }); await switchWalletNetwork(wallet, XLAYER);
    provider = new ethers.BrowserProvider(wallet, 'any', { cacheTimeout: -1 }); signer = await provider.getSigner(); account = await signer.getAddress();
    if (account.toLowerCase() !== config.participant.toLowerCase()) { account = null; throw Error(`Select the pilot wallet ${config.participant}.`); }
    pool = new ethers.Contract(config.pool, config.abi, signer); stable = new ethers.Contract(config.stable,tokenAbi,signer); wrapper = new ethers.Contract(config.collateral,tokenAbi,signer); token = new ethers.Contract(config.underlying,tokenAbi,signer);
    if ((await pool.participant()).toLowerCase() !== account.toLowerCase() || await pool.supplyCap() !== 20000n || await pool.debtCeiling() !== 10000n || (await wrapper.asset()).toLowerCase() !== config.underlying.toLowerCase() || ethers.keccak256(await provider.getCode(config.pool)) !== config.runtimeCodeHash) throw Error('Deployed pilot verification failed.');
    unwatch?.(); unwatch = watchWallet(wallet, () => { account = null; state = null; controls(); $('connect').textContent = 'Reconnect wallet'; status('Wallet changed. Reconnect to continue.'); });
    await refresh(); $('connect').textContent = '0x1DcB…32d2'; status(state.balance < 21000n && state.supplied === 0n ? 'Add 0.021 USDG to this wallet to start. OKB pays gas separately.' : pilotPosition(state).description);
  } catch(error) { account = null; state = null; status(error.shortMessage || error.message); }
  finally { busy = false; controls(); }
};
buttons.forEach(button => button.onclick = () => action(button.dataset.action));
$('refresh').onclick = async () => { try { await refresh(); status('Balances refreshed and recorded.'); } catch(error) { status(error.shortMessage || error.message); } };
$('export').onclick = () => { const blob = new Blob([JSON.stringify({ deployment: config, recordedEvidence, browserEvidence: log },null,2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'vadium-private-pilot-evidence.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000); };
if (config.pool) { $('poolLink').href = `${XLAYER.explorer}/address/${config.pool}`; $('poolLink').textContent = `Pool ${config.pool.slice(0,10)}…`; }
renderLog(); controls();

async function loadHistory() {
  try {
    const response = await fetch('/pilot-evidence.json', { cache: 'no-store' });
    if (!response.ok) throw Error('Recorded evidence unavailable');
    const data = await response.json();
    if (data.credit.pool.toLowerCase() !== config.pool.toLowerCase() || data.credit.participant.toLowerCase() !== config.participant.toLowerCase() || data.wrapper.wrapper.toLowerCase() !== config.collateral.toLowerCase()) throw Error('Evidence does not match this facility');
    recordedEvidence = data;
    $('historySummary').textContent = data.credit.creditCycleCompleted && data.wrapper.wrapperRoundTripVerified ? 'Completed mainnet cycle · recorded evidence' : 'Mainnet transaction record';
    $('historyMeta').textContent = `Snapshot block ${data.credit.block} · ${new Date(data.credit.at).toLocaleString()} · historical balances, not a live wallet reading.`;
    const names = { LiquiditySupplied: 'USDG supplied', Deposit: 'NVDAx wrapped', CollateralDeposited: 'Collateral deposited', Borrowed: 'USDG borrowed', Repaid: 'Debt repaid', CollateralWithdrawn: 'Collateral withdrawn', Withdraw: 'NVDAx unwrapped', LiquidityWithdrawn: 'Lender funds redeemed' };
    const events = [...data.credit.events, ...data.wrapper.events].filter(x => names[x.event]).sort((a,b) => a.block - b.block || a.index - b.index);
    const receipts = [...data.credit.receipts, ...data.wrapper.receipts];
    for (const event of events) {
      if (!/^0x[0-9a-f]{64}$/i.test(event.hash)) continue;
      const row = document.createElement('li');
      const label = document.createElement('strong'); label.textContent = names[event.event];
      const detail = document.createElement('span');
      const amount = ['LiquiditySupplied','Borrowed','Repaid','LiquidityWithdrawn'].includes(event.event) ? `${ethers.formatUnits(event.args[1],6)} USDG · ` : '';
      const confirmed = receipts.some(x => x.hash === event.hash && x.status === 1);
      detail.textContent = `${amount}${confirmed ? 'Confirmed' : 'Receipt pending'} · block ${event.block}`;
      const link = document.createElement('a'); link.href = `${XLAYER.explorer}/tx/${event.hash}`; link.textContent = 'View receipt ↗'; link.target = '_blank'; link.rel = 'noreferrer';
      row.append(label,detail,link); $('historyRows').append(row);
    }
  } catch(error) { $('historySummary').textContent = 'Recorded history unavailable'; $('historyMeta').textContent = `${error.message}. Wallet actions remain subject to live contract checks.`; }
}
void loadHistory();
