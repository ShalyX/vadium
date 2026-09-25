import { BrowserProvider, Contract, formatUnits, parseUnits } from 'https://cdn.jsdelivr.net/npm/ethers@6.17.0/+esm';

const config = window.VADIUM_CONFIG;

const poolAbi = [
  'function stable() view returns (address)', 'function collateral() view returns (address)',
  'function totalAssets() view returns (uint256)', 'function totalDebt() view returns (uint256)',
  'function liquidityShares(address) view returns (uint256)', 'function collateralOf(address) view returns (uint256)',
  'function debtOf(address) view returns (uint256)', 'function borrowCapacity(address) view returns (uint256)',
  'function creditMultiplierBps() view returns (uint256)', 'function supply(uint256) returns (uint256)',
  'function depositCollateral(uint256)', 'function borrow(uint256)', 'function repay(uint256) returns (uint256)',
  'function withdrawCollateral(uint256)',
];
const oracleAbi = ['function currentRisk(address) view returns (bool,(uint128 price,uint16 freshnessBps,uint16 liquidityBps,uint64 asOf,uint8 state,bytes32 inputsHash))'];
const erc20Abi = ['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];

const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  'connectButton','networkLabel','marketName','marketPill','positionValue','collateralValue','debtValue','capacityValue',
  'amountLabel','amountInput','maxButton','actionButton','actionMessage','updatedAt','sessionValue','freshnessValue',
  'liquidityValue','multiplierValue','freshnessRail','liquidityRail','multiplierRail','permissionValue','oracleLink',
  'poolLiquidity','poolDebt',
].map((id) => [id, $(id)]));

let provider;
let signer;
let account;
let pool;
let oracle;
let stable;
let collateral;
let stableDecimals = 18;
let collateralDecimals = 18;
let stableSymbol = 'dUSD';
let collateralSymbol = 'AAPLx';
let selectedAction = 'deposit';
let snapshot = {};
let pending = false;

const short = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const number = (value, decimals, digits = 2) => Number(formatUnits(value, decimals)).toLocaleString(undefined, { maximumFractionDigits: digits });
const pct = (bps) => `${(Number(bps) / 100).toFixed(Number(bps) % 100 ? 1 : 0)}%`;
const configured = () => [config.pool, config.oracle, config.stable, config.collateral].every((value) => /^0x[0-9a-fA-F]{40}$/.test(value));

function setMessage(message, error = false) {
  ui.actionMessage.textContent = message;
  ui.actionMessage.style.color = error ? '#ff7a45' : '';
}

function setPending(value, label = '') {
  pending = value;
  ui.actionButton.disabled = value || !account;
  ui.actionButton.textContent = value ? label : ({ deposit: `Deposit ${collateralSymbol}`, borrow: `Borrow ${stableSymbol}`, repay: `Repay ${stableSymbol}`, withdraw: `Withdraw ${collateralSymbol}` })[selectedAction];
}

async function ensureNetwork() {
  const chainHex = `0x${config.chainId.toString(16)}`;
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{
      chainId: chainHex,
      chainName: config.chainId === 196 ? 'X Layer' : 'X Layer Testnet',
      nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
      rpcUrls: [config.rpcUrl], blockExplorerUrls: [config.explorer],
    }] });
  }
}

async function connect() {
  if (!window.ethereum) return setMessage('Install an EVM wallet such as OKX Wallet to continue.', true);
  if (!configured()) return setMessage('Deployment addresses are not configured yet.', true);
  try {
    ui.connectButton.disabled = true;
    await ensureNetwork();
    provider = new BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    account = await signer.getAddress();
    pool = new Contract(config.pool, poolAbi, signer);
    oracle = new Contract(config.oracle, oracleAbi, signer);
    stable = new Contract(config.stable, erc20Abi, signer);
    collateral = new Contract(config.collateral, erc20Abi, signer);
    [stableDecimals, collateralDecimals, stableSymbol, collateralSymbol] = await Promise.all([
      stable.decimals(), collateral.decimals(), stable.symbol(), collateral.symbol(),
    ]);
    stableDecimals = Number(stableDecimals);
    collateralDecimals = Number(collateralDecimals);
    ui.connectButton.textContent = short(account);
    ui.networkLabel.textContent = config.chainId === 196 ? 'X Layer Mainnet' : 'X Layer Testnet';
    ui.marketName.textContent = `${collateralSymbol} / ${stableSymbol}`;
    ui.oracleLink.href = `${config.explorer}/address/${config.oracle}`;
    setPending(false);
    await refresh();
  } catch (error) {
    setMessage(error.shortMessage || error.message || 'Wallet connection failed.', true);
  } finally {
    ui.connectButton.disabled = false;
  }
}

async function refresh() {
  if (!account) return;
  try {
    const [collateralAmount, debt, capacity, assets, poolDebt, multiplier, riskResult, stableBalance, collateralBalance] = await Promise.all([
      pool.collateralOf(account), pool.debtOf(account), pool.borrowCapacity(account), pool.totalAssets(), pool.totalDebt(),
      pool.creditMultiplierBps(), oracle.currentRisk(config.collateral), stable.balanceOf(account), collateral.balanceOf(account),
    ]);
    const [available, risk] = riskResult;
    snapshot = { collateralAmount, debt, capacity, assets, poolDebt, multiplier, stableBalance, collateralBalance };
    ui.collateralValue.textContent = `${number(collateralAmount, collateralDecimals, 4)} ${collateralSymbol}`;
    ui.debtValue.textContent = `${number(debt, stableDecimals)} ${stableSymbol}`;
    ui.capacityValue.textContent = `${number(capacity > debt ? capacity - debt : 0n, stableDecimals)} ${stableSymbol}`;
    ui.positionValue.textContent = number(capacity, stableDecimals);
    ui.poolLiquidity.textContent = `${number(assets - poolDebt, stableDecimals)} ${stableSymbol}`;
    ui.poolDebt.textContent = `${number(poolDebt, stableDecimals)} ${stableSymbol}`;
    ui.multiplierValue.textContent = pct(multiplier);
    ui.multiplierRail.style.width = `${Math.min(Number(multiplier) / 100, 100)}%`;
    const sessionNames = ['OPEN', 'CLOSED', 'UNAVAILABLE'];
    ui.sessionValue.textContent = available ? sessionNames[Number(risk.state)] : 'STALE';
    ui.freshnessValue.textContent = available ? pct(risk.freshnessBps) : '0%';
    ui.liquidityValue.textContent = available ? pct(risk.liquidityBps) : '0%';
    ui.freshnessRail.style.width = `${available ? Math.min(Number(risk.freshnessBps) / 100, 100) : 0}%`;
    ui.liquidityRail.style.width = `${available ? Math.min(Number(risk.liquidityBps) / 100, 100) : 0}%`;
    ui.updatedAt.textContent = available ? new Date(Number(risk.asOf) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'STALE DATA';
    const enabled = multiplier > 0n;
    ui.permissionValue.textContent = enabled ? (Number(risk.state) === 1 ? 'LIMITED' : 'ENABLED') : 'PAUSED';
    ui.marketPill.textContent = enabled ? `MARKET ${sessionNames[Number(risk.state)]}` : 'RISK PAUSE';
    ui.marketPill.className = `status-pill ${enabled ? 'live' : 'blocked'}`;
  } catch (error) {
    setMessage(`Could not refresh live contract state: ${error.shortMessage || error.message}`, true);
    ui.marketPill.textContent = 'READ FAILURE';
    ui.marketPill.className = 'status-pill blocked';
  }
}

async function approveIfNeeded(token, amount) {
  const allowance = await token.allowance(account, config.pool);
  if (allowance >= amount) return;
  setPending(true, 'Approving…');
  const approval = await token.approve(config.pool, amount);
  await approval.wait();
}

async function execute() {
  if (pending || !account) return;
  const raw = ui.amountInput.value.trim();
  if (!/^\d+(\.\d+)?$/.test(raw) || Number(raw) <= 0) return setMessage('Enter a valid amount.', true);
  try {
    const usesCollateral = selectedAction === 'deposit' || selectedAction === 'withdraw';
    const amount = parseUnits(raw, usesCollateral ? collateralDecimals : stableDecimals);
    if (selectedAction === 'deposit') await approveIfNeeded(collateral, amount);
    if (selectedAction === 'repay') await approveIfNeeded(stable, amount);
    setPending(true, 'Confirming on X Layer…');
    const method = { deposit: 'depositCollateral', borrow: 'borrow', repay: 'repay', withdraw: 'withdrawCollateral' }[selectedAction];
    const transaction = await pool[method](amount);
    setMessage(`Transaction submitted: ${short(transaction.hash)}`);
    await transaction.wait();
    ui.amountInput.value = '';
    setMessage('Transaction confirmed on X Layer.');
    await refresh();
  } catch (error) {
    setMessage(error.shortMessage || error.reason || error.message || 'Transaction failed.', true);
  } finally {
    setPending(false);
  }
}

function selectAction(action) {
  selectedAction = action;
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.action === action));
  const collateralAction = action === 'deposit' || action === 'withdraw';
  ui.amountLabel.textContent = `${collateralAction ? collateralSymbol : stableSymbol} amount`;
  if (account) setPending(false);
}

function fillMax() {
  if (!account) return;
  const values = {
    deposit: [snapshot.collateralBalance, collateralDecimals],
    borrow: [snapshot.capacity > snapshot.debt ? snapshot.capacity - snapshot.debt : 0n, stableDecimals],
    repay: [snapshot.debt < snapshot.stableBalance ? snapshot.debt : snapshot.stableBalance, stableDecimals],
    withdraw: [snapshot.collateralAmount, collateralDecimals],
  };
  const [value, decimals] = values[selectedAction];
  ui.amountInput.value = formatUnits(value || 0n, decimals);
}

ui.connectButton.addEventListener('click', connect);
ui.actionButton.addEventListener('click', execute);
ui.maxButton.addEventListener('click', fillMax);
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => selectAction(tab.dataset.action)));
window.ethereum?.on?.('accountsChanged', () => window.location.reload());
window.ethereum?.on?.('chainChanged', () => window.location.reload());

if (!configured()) setMessage('Contracts are ready. Add deployment addresses to activate the live interface.');
