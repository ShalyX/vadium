import { BrowserProvider, Contract, JsonRpcProvider, formatUnits, parseUnits } from '../vendor/ethers.min.js';

const config = window.VADIUM_CONFIG;

const poolAbi = [
  'function stable() view returns (address)', 'function collateral() view returns (address)',
  'function baseBorrowLtvBps() view returns (uint16)', 'function liquidationLtvBps() view returns (uint16)', 'function closedSessionFactorBps() view returns (uint16)',
  'function minFreshnessBps() view returns (uint16)', 'function minLiquidityBps() view returns (uint16)',
  'function totalAssets() view returns (uint256)', 'function totalDebt() view returns (uint256)',
  'function underlyingCollateral() view returns (address)',
  'function borrowPaused() view returns (bool)', 'function supplyPaused() view returns (bool)',
  'function liquidityShares(address) view returns (uint256)', 'function collateralOf(address) view returns (uint256)',
  'function debtOf(address) view returns (uint256)', 'function borrowCapacity(address) view returns (uint256)',
  'function creditMultiplierBps() view returns (uint256)', 'function supply(uint256) returns (uint256)',
  'function withdrawLiquidity(uint256) returns (uint256)',
  'function depositCollateral(uint256)', 'function borrow(uint256)', 'function repay(uint256) returns (uint256)',
  'function withdrawCollateral(uint256)',
  'error RiskUnavailable()', 'error RiskLimit()', 'error InsufficientCash()', 'error Paused()',
  'error DebtCeilingExceeded()', 'error InsufficientShares()', 'error ZeroAmount()', 'error TransferFailed()', 'error UnexpectedTransferAmount()',
];
const oracleAbi = ['function currentRisk(address) view returns (bool,(uint128 price,uint16 freshnessBps,uint16 liquidityBps,uint64 asOf,uint8 state,bytes32 inputsHash))'];
const erc20Abi = ['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function mint(address,uint256)', 'function asset() view returns (address)', 'function convertToAssets(uint256) view returns (uint256)'];

const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  'connectButton','networkLabel','marketName','marketPill','positionValue','collateralValue','debtValue','capacityValue',
  'amountLabel','amountInput','maxButton','actionButton','actionMessage','updatedAt','sessionValue','freshnessValue',
  'liquidityValue','multiplierValue','freshnessRail','liquidityRail','multiplierRail','permissionValue','oracleLink',
  'poolLiquidity','poolDebt','walletCollateral','walletStable','sharesValue','mintStockButton','mintStableButton',
  'riskExplanation','actionHelp','refreshButton','transactionLink',
  'environmentTitle','environmentCopy','startTitle','startCopy','startActions','quoteDescription','quoteLabel',
  'marketDescription','walletCollateralLabel','walletStableLabel','baseLtvValue','liquidationLtvValue','mainnetProof',
  'quoteAmount','quoteCurrent','quoteOpen','quoteClosed','quoteUnavailable','quoteNote',
].map((id) => [id, $(id)]));

let provider;
let signer;
let account;
let pool;
let oracle;
let stable;
let collateral;
let writePool;
let writeStable;
let writeCollateral;
let stableDecimals = 18;
let collateralDecimals = 18;
let underlyingDecimals = 18;
let underlyingPerWhole = 10n ** 18n;
let stableSymbol = 'dUSD';
let collateralSymbol = 'AAPLx';
let selectedAction = 'deposit';
let snapshot = {};
let pending = false;
let riskAvailable = false;
let multiplier = 0n;
let currentRisk;
let quoteParams;
let activeRpcUrl = config?.rpcUrl;
let readProvider;
let marketReady = false;
let refreshing = false;
let operatorBorrowPaused = false;
let operatorSupplyPaused = false;

const short = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const number = (value, decimals, digits = 2) => Number(formatUnits(value, decimals)).toLocaleString(undefined, { maximumFractionDigits: digits });
const pct = (bps) => `${(Number(bps) / 100).toFixed(Number(bps) % 100 ? 1 : 0)}%`;
const configured = () => config && [config.pool, config.oracle, config.stable, config.collateral].every((value) => /^0x[0-9a-fA-F]{40}$/.test(value));
const canMintDemo = () => configured() && config.chainId === 1952 && config.demoAssets === true;
const liveMarket = () => config?.chainId === 196 && config.marketMode === 'live'
  && config.demoAssets === false && /^0x[0-9a-fA-F]{40}$/.test(config.underlyingCollateral);
const writeEnabled = () => canMintDemo() || liveMarket();
const timeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => window.setTimeout(() => reject(new Error('RPC request timed out')), ms)),
]);

async function probeRpc(url) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}`);
  const body = await response.json();
  if (Number.parseInt(body.result, 16) !== config.chainId) throw new Error('RPC chain ID mismatch');
}

function setMessage(message, error = false) {
  ui.actionMessage.textContent = message;
  ui.actionMessage.style.color = error ? '#ff7a45' : '';
}

function showTransaction(hash) {
  ui.transactionLink.hidden = !hash;
  if (hash) ui.transactionLink.href = `${config.explorer}/tx/${hash}`;
}

function explain(error) {
  const name = error?.revert?.name || (() => {
    try { return pool?.interface?.parseError(error?.data)?.name; }
    catch { return undefined; }
  })();
  if (error?.code === 4001 || error?.code === 'ACTION_REJECTED') return 'Request rejected in your wallet. No transaction was sent.';
  return {
    RiskUnavailable: 'New borrowing is paused until the oracle has a current usable update.',
    RiskLimit: 'The amount exceeds your current borrowing limit.',
    InsufficientCash: 'The pool does not have enough available liquidity.',
    DebtCeilingExceeded: 'This pool has reached its debt limit.',
    InsufficientShares: 'You do not own that many liquidity shares.',
    ZeroAmount: 'Enter an amount greater than zero.',
    TransferFailed: 'Token transfer failed. Check your balance and approval.',
    UnexpectedTransferAmount: 'This token changes the transfer amount and is not supported by this market.',
    Paused: 'The operator has temporarily paused this action. Your existing position remains visible.',
  }[name] || error?.shortMessage || error?.reason || error?.message || 'Transaction failed.';
}

function setPending(value, label = '') {
  pending = value;
  ui.actionButton.disabled = value || !account || !marketReady || !writeEnabled()
    || (selectedAction === 'borrow' && (!riskAvailable || multiplier === 0n || operatorBorrowPaused))
    || (selectedAction === 'supply' && operatorSupplyPaused);
  ui.actionButton.textContent = value ? label : !writeEnabled() && config?.chainId === 196 ? 'Read-only deployment'
    : ({ deposit: `Deposit ${collateralSymbol}`, borrow: `Borrow ${stableSymbol}`, repay: `Repay ${stableSymbol}`, withdraw: `Withdraw ${collateralSymbol}`, supply: `Supply ${stableSymbol}`, redeem: 'Redeem liquidity shares' })[selectedAction];
  ui.mintStockButton.disabled = value || !account || !marketReady || !canMintDemo();
  ui.mintStableButton.disabled = value || !account || !marketReady || !canMintDemo();
  ui.maxButton.disabled = value || !account || !marketReady || !writeEnabled();
  ui.refreshButton.disabled = value || refreshing || !pool;
  document.querySelectorAll('.tab').forEach((tab) => { tab.disabled = value; });
}

function renderQuote() {
  if (!quoteParams || !currentRisk) {
    for (const field of [ui.quoteCurrent, ui.quoteOpen, ui.quoteClosed, ui.quoteUnavailable]) field.textContent = '—';
    ui.quoteNote.textContent = 'Current market data is unavailable. Refresh to try again.';
    return;
  }
  const raw = ui.quoteAmount.value.trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    for (const field of [ui.quoteCurrent, ui.quoteOpen, ui.quoteClosed]) field.textContent = '—';
    ui.quoteNote.textContent = `Enter a nonnegative ${collateralSymbol} amount.`;
    return;
  }
  let amount;
  try { amount = parseUnits(raw, collateralDecimals); }
  catch {
    for (const field of [ui.quoteCurrent, ui.quoteOpen, ui.quoteClosed]) field.textContent = '—';
    ui.quoteNote.textContent = 'Too many decimal places for this token.';
    return;
  }
  if (!riskAvailable) {
    for (const field of [ui.quoteCurrent, ui.quoteOpen, ui.quoteClosed]) field.textContent = `0 ${stableSymbol}`;
    ui.quoteNote.textContent = 'The oracle is unavailable or stale. New borrowing is paused.';
    return;
  }
  const { baseLtv, closedFactor, minFreshness, minLiquidity } = quoteParams;
  const underlyingAmount = amount * underlyingPerWhole / (10n ** BigInt(collateralDecimals));
  const usd18 = underlyingAmount * currentRisk.price / (10n ** BigInt(underlyingDecimals));
  const value = stableDecimals < 18 ? usd18 / (10n ** BigInt(18 - stableDecimals))
    : usd18 * (10n ** BigInt(stableDecimals - 18));
  let score = currentRisk.freshnessBps < currentRisk.liquidityBps
    ? currentRisk.freshnessBps : currentRisk.liquidityBps;
  if (score > 10_000n) score = 10_000n;
  if (currentRisk.freshnessBps < minFreshness || currentRisk.liquidityBps < minLiquidity) score = 0n;
  const closedScore = score * closedFactor / 10_000n;
  const capacity = (factor) => value * baseLtv * factor / 10_000n / 10_000n;
  ui.quoteCurrent.textContent = `${number(operatorBorrowPaused ? 0n : capacity(multiplier), stableDecimals, 2)} ${stableSymbol}`;
  ui.quoteOpen.textContent = `${number(capacity(score), stableDecimals, 2)} ${stableSymbol}`;
  ui.quoteClosed.textContent = `${number(capacity(closedScore), stableDecimals, 2)} ${stableSymbol}`;
  ui.quoteUnavailable.textContent = `0 ${stableSymbol}`;
  ui.quoteNote.textContent = operatorBorrowPaused
    ? 'The operator has paused new borrowing. Scenario limits show what the oracle would otherwise allow.'
    : 'Illustrative limit at the current oracle price and liquidity score. It is not a promise of a future price or available cash.';
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
      rpcUrls: [activeRpcUrl], blockExplorerUrls: [config.explorer],
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
    writePool = pool.connect(signer);
    writeStable = stable.connect(signer);
    writeCollateral = collateral.connect(signer);
    ui.connectButton.textContent = short(account);
    ui.networkLabel.textContent = config.chainId === 196 ? 'X Layer Mainnet' : 'X Layer Testnet';
    ui.marketName.textContent = `${collateralSymbol} / ${stableSymbol}`;
    ui.oracleLink.href = `${config.explorer}/address/${config.oracle}`;
    setMessage('Wallet connected. Loading your live position…');
    setPending(false);
    await refresh();
    if (marketReady) setMessage(writeEnabled() ? 'Wallet connected. Your position is up to date.' : 'Wallet connected. This deployment is read-only.');
  } catch (error) {
    setMessage(error.shortMessage || error.message || 'Wallet connection failed.', true);
  } finally {
    ui.connectButton.disabled = false;
  }
}

async function refresh(force = false) {
  if (!configured() || !pool || refreshing || (pending && !force)) return;
  refreshing = true;
  ui.refreshButton.disabled = true;
  try {
    const [assets, poolDebt, nextMultiplier, riskResult, conversion, pauses] = await Promise.all([
      pool.totalAssets(), pool.totalDebt(), pool.creditMultiplierBps(), oracle.currentRisk(config.collateral),
      liveMarket() ? collateral.convertToAssets(10n ** BigInt(collateralDecimals)) : Promise.resolve(10n ** BigInt(collateralDecimals)),
      liveMarket() ? Promise.all([pool.borrowPaused(), pool.supplyPaused()]) : Promise.resolve([false, false]),
    ]);
    const [available, risk] = riskResult;
    if (assets < poolDebt) throw new Error('Pool accounting is inconsistent.');
    riskAvailable = available;
    multiplier = nextMultiplier;
    [operatorBorrowPaused, operatorSupplyPaused] = pauses;
    currentRisk = risk;
    if (conversion <= 0n) throw new Error('Wrapped collateral conversion is unavailable.');
    underlyingPerWhole = conversion;
    renderQuote();
    ui.poolLiquidity.textContent = `${number(assets - poolDebt, stableDecimals)} ${stableSymbol}`;
    ui.poolDebt.textContent = `${number(poolDebt, stableDecimals)} ${stableSymbol}`;
    ui.multiplierValue.textContent = pct(multiplier);
    ui.multiplierRail.style.width = `${Math.min(Number(multiplier) / 100, 100)}%`;
    const sessionNames = ['OPEN', 'CLOSED', 'UNAVAILABLE'];
    const state = available ? sessionNames[Number(risk.state)] : Number(risk.state) === 2 ? 'UNAVAILABLE' : 'STALE';
    ui.sessionValue.textContent = state;
    ui.freshnessValue.textContent = available ? pct(risk.freshnessBps) : '—';
    ui.liquidityValue.textContent = available ? pct(risk.liquidityBps) : '—';
    ui.freshnessRail.style.width = `${available ? Math.min(Number(risk.freshnessBps) / 100, 100) : 0}%`;
    ui.liquidityRail.style.width = `${available ? Math.min(Number(risk.liquidityBps) / 100, 100) : 0}%`;
    ui.updatedAt.textContent = Number(risk.asOf) ? `Published ${new Date(Number(risk.asOf) * 1000).toLocaleString()}` : 'NO UPDATE';
    const enabled = multiplier > 0n && !operatorBorrowPaused;
    ui.permissionValue.textContent = enabled ? (Number(risk.state) === 1 ? 'LIMITED' : 'ENABLED') : 'PAUSED';
    ui.marketPill.textContent = enabled ? `MARKET ${state}` : state === 'STALE' ? 'ORACLE STALE' : 'RISK PAUSE';
    ui.marketPill.className = `status-pill ${enabled ? 'live' : 'blocked'}`;
    ui.riskExplanation.textContent = operatorBorrowPaused
      ? 'The operator has paused new borrowing. Deposits and repayments remain available.'
      : state === 'STALE'
      ? 'The oracle update has expired. New borrowing is paused; deposits, supply, and repayments remain available.'
      : state === 'UNAVAILABLE'
        ? 'Market data is unavailable. New borrowing is paused; existing debt can still be repaid.'
        : state === 'CLOSED'
          ? 'The reference market is closed, so new credit is reduced.'
          : 'The current oracle update permits borrowing within the displayed limit.';
    if (account) {
      const [collateralAmount, debt, capacity, stableBalance, collateralBalance, shares] = await Promise.all([
        pool.collateralOf(account), pool.debtOf(account), pool.borrowCapacity(account),
        stable.balanceOf(account), collateral.balanceOf(account), pool.liquidityShares(account),
      ]);
      snapshot = { collateralAmount, debt, capacity, assets, poolDebt, multiplier, stableBalance, collateralBalance, shares };
      ui.collateralValue.textContent = `${number(collateralAmount, collateralDecimals, 4)} ${collateralSymbol}`;
      ui.debtValue.textContent = `${number(debt, stableDecimals)} ${stableSymbol}`;
      ui.capacityValue.textContent = `${number(capacity > debt ? capacity - debt : 0n, stableDecimals)} ${stableSymbol}`;
      ui.walletCollateral.textContent = `${number(collateralBalance, collateralDecimals, 4)} ${collateralSymbol}`;
      ui.walletStable.textContent = `${number(stableBalance, stableDecimals, 4)} ${stableSymbol}`;
      ui.sharesValue.textContent = number(shares, stableDecimals, 4);
      const underlyingAmount = collateralAmount * underlyingPerWhole / (10n ** BigInt(collateralDecimals));
      const valueUsd = available ? underlyingAmount * risk.price / (10n ** BigInt(underlyingDecimals)) : 0n;
      ui.positionValue.textContent = available ? number(valueUsd, 18) : '—';
    }
    marketReady = true;
    setPending(pending);
  } catch (error) {
    setMessage(`Could not refresh live contract state: ${explain(error)}`, true);
    ui.marketPill.textContent = 'READ FAILURE';
    ui.marketPill.className = 'status-pill blocked';
    ui.sessionValue.textContent = 'UNKNOWN';
    ui.permissionValue.textContent = 'PAUSED';
    ui.riskExplanation.textContent = 'The chain could not be reached. Refresh the page to retry.';
    ui.poolLiquidity.textContent = '—';
    ui.poolDebt.textContent = '—';
    for (const field of [ui.positionValue, ui.collateralValue, ui.debtValue, ui.capacityValue,
      ui.walletCollateral, ui.walletStable, ui.sharesValue, ui.freshnessValue,
      ui.liquidityValue, ui.multiplierValue]) field.textContent = '—';
    for (const rail of [ui.freshnessRail, ui.liquidityRail, ui.multiplierRail]) rail.style.width = '0%';
    ui.updatedAt.textContent = 'READ FAILED';
    snapshot = {};
    currentRisk = undefined;
    marketReady = false;
    operatorBorrowPaused = false;
    operatorSupplyPaused = false;
    riskAvailable = false;
    multiplier = 0n;
    renderQuote();
    setPending(pending);
  } finally {
    refreshing = false;
    ui.refreshButton.disabled = pending || !pool;
  }
}

async function approveIfNeeded(token, amount) {
  const allowance = await token.allowance(account, config.pool);
  if (allowance >= amount) return;
  setPending(true, 'Approving…');
  setMessage('Approve the exact amount in your wallet…');
  const approval = await token.approve(config.pool, amount);
  showTransaction(approval.hash);
  const receipt = await approval.wait();
  if (receipt?.status !== 1) throw new Error('Approval did not confirm successfully. Check the transaction before retrying.');
}

async function checkWallet() {
  if (!signer || (await signer.getAddress()).toLowerCase() !== account.toLowerCase()) {
    throw new Error('The connected account changed. Reconnect your wallet before continuing.');
  }
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== config.chainId) throw new Error('Switch your wallet back to the configured X Layer network.');
}

async function mintDemo(kind) {
  if (!canMintDemo() || !account || !marketReady || pending) return;
  const token = kind === 'stock' ? writeCollateral : writeStable;
  const amount = kind === 'stock' ? parseUnits('10', collateralDecimals) : parseUnits('100', stableDecimals);
  const label = kind === 'stock' ? 'Demo AAPLx mint' : 'Demo dUSD mint';
  try {
    setPending(true, 'Minting…');
    showTransaction();
    await checkWallet();
    const transaction = await token.mint(account, amount);
    showTransaction(transaction.hash);
    setMessage(`${label} submitted: ${short(transaction.hash)}. Waiting for confirmation…`);
    const receipt = await transaction.wait();
    if (receipt.status !== 1) throw new Error('Transaction reverted.');
    setMessage(`${label} confirmed: ${transaction.hash}`);
    await refresh(true);
  } catch (error) {
    setMessage(`${label} failed: ${explain(error)}`, true);
  } finally {
    setPending(false);
  }
}

async function execute() {
  if (pending || !account || !marketReady || !writeEnabled()) return;
  const action = selectedAction;
  if (action === 'borrow' && (!riskAvailable || multiplier === 0n || operatorBorrowPaused)) {
    return setMessage(operatorBorrowPaused ? 'The operator has paused new borrowing.' : 'Borrowing is paused until a current oracle update is available.', true);
  }
  if (action === 'supply' && operatorSupplyPaused) return setMessage('The operator has paused new liquidity supply.', true);
  const raw = ui.amountInput.value.trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return setMessage('Enter a positive amount.', true);
  try {
    showTransaction();
    await checkWallet();
    const usesCollateral = action === 'deposit' || action === 'withdraw';
    const amount = parseUnits(raw, usesCollateral ? collateralDecimals : stableDecimals);
    if (amount <= 0n) return setMessage('Enter a positive amount.', true);
    if (action === 'borrow' && amount > (snapshot.capacity > snapshot.debt ? snapshot.capacity - snapshot.debt : 0n)) {
      return setMessage('Amount exceeds the currently available credit.', true);
    }
    const available = {
      deposit: snapshot.collateralBalance,
      repay: snapshot.debt < snapshot.stableBalance ? snapshot.debt : snapshot.stableBalance,
      withdraw: snapshot.collateralAmount,
      supply: snapshot.stableBalance,
      redeem: snapshot.shares,
    }[action];
    if (available !== undefined && amount > available) return setMessage('Amount exceeds your available balance or position.', true);
    if (action === 'deposit') await approveIfNeeded(writeCollateral, amount);
    if (action === 'repay' || action === 'supply') await approveIfNeeded(writeStable, amount);
    await checkWallet();
    setPending(true, 'Confirming on X Layer…');
    const method = { deposit: 'depositCollateral', borrow: 'borrow', repay: 'repay', withdraw: 'withdrawCollateral', supply: 'supply', redeem: 'withdrawLiquidity' }[action];
    setMessage('Checking the action against the latest onchain rules…');
    await writePool[method].staticCall(amount);
    const transaction = await writePool[method](amount);
    showTransaction(transaction.hash);
    setMessage(`Transaction submitted: ${short(transaction.hash)}`);
    const receipt = await transaction.wait();
    if (receipt?.status !== 1) throw new Error('Transaction did not confirm successfully. Check the explorer before retrying.');
    ui.amountInput.value = '';
    setMessage(`Transaction confirmed on X Layer: ${transaction.hash}`);
    await refresh(true);
  } catch (error) {
    setMessage(explain(error), true);
  } finally {
    setPending(false);
  }
}

function selectAction(action) {
  if (pending) return;
  selectedAction = action;
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.action === action));
  const collateralAction = action === 'deposit' || action === 'withdraw';
  ui.amountLabel.textContent = action === 'redeem' ? 'Liquidity shares to redeem' : `${collateralAction ? collateralSymbol : stableSymbol} amount`;
  ui.actionHelp.textContent = {
    deposit: `Lock ${collateralSymbol} as collateral. This does not create debt.`,
    borrow: `Borrow ${stableSymbol} within your current limit. The limit can shrink when market conditions change.`,
    repay: `Return borrowed ${stableSymbol}. Repayment remains available during a risk pause.`,
    withdraw: `Release collateral. Any remaining debt must stay within the current limit.`,
    supply: `Add ${stableSymbol} liquidity and receive pool shares.`,
    redeem: `Redeem your pool shares for available ${stableSymbol} liquidity.`,
  }[action];
  ui.amountInput.value = '';
  setPending(pending);
}

function fillMax() {
  if (!account) return;
  const values = {
    deposit: [snapshot.collateralBalance, collateralDecimals],
    borrow: [snapshot.capacity > snapshot.debt ? snapshot.capacity - snapshot.debt : 0n, stableDecimals],
    repay: [snapshot.debt < snapshot.stableBalance ? snapshot.debt : snapshot.stableBalance, stableDecimals],
    withdraw: [snapshot.collateralAmount, collateralDecimals],
    supply: [snapshot.stableBalance, stableDecimals],
    redeem: [snapshot.shares, stableDecimals],
  };
  const [value, decimals] = values[selectedAction];
  ui.amountInput.value = formatUnits(value || 0n, decimals);
}

ui.connectButton.addEventListener('click', connect);
ui.actionButton.addEventListener('click', execute);
ui.maxButton.addEventListener('click', fillMax);
ui.refreshButton.addEventListener('click', () => { if (quoteParams) refresh(); else init(); });
ui.quoteAmount.addEventListener('input', renderQuote);
ui.mintStockButton.addEventListener('click', () => mintDemo('stock'));
ui.mintStableButton.addEventListener('click', () => mintDemo('stable'));
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => selectAction(tab.dataset.action)));
window.ethereum?.on?.('accountsChanged', () => window.location.reload());
window.ethereum?.on?.('chainChanged', () => window.location.reload());

async function init() {
  if (!configured()) return setMessage('Contracts are not configured.', true);
  const live = liveMarket();
  if (live) {
    ui.environmentTitle.textContent = 'X Layer mainnet market';
    ui.environmentCopy.textContent = 'Transactions use real assets. Review the market risk state and contract addresses before depositing or supplying.';
    ui.startTitle.textContent = 'Use your X Layer assets';
    ui.startCopy.textContent = 'Connect your wallet, deposit supported collateral to borrow, or supply the stable asset to the pool. You need OKB for transaction fees.';
    ui.startActions.hidden = true;
    ui.mainnetProof.hidden = true;
    ui.marketDescription.textContent = 'Isolated mainnet lending market';
  } else if (config.chainId === 196) {
    ui.environmentTitle.textContent = 'Mainnet transaction proof';
    ui.environmentCopy.textContent = 'This pool uses permissionless demo collateral. It is read-only here and must not receive user funds.';
    ui.startTitle.textContent = 'Inspect the proof';
    ui.startCopy.textContent = 'The separate loan and repayment transactions below demonstrate the mechanism with real USDG. The release market will use verified wrapped xStock collateral.';
    ui.startActions.hidden = true;
    ui.marketDescription.textContent = 'Demo collateral / read-only proof';
  }
  ui.refreshButton.disabled = true;
  ui.networkLabel.textContent = config.chainId === 196 ? 'X Layer Mainnet' : 'X Layer Testnet';
  ui.oracleLink.href = `${config.explorer}/address/${config.oracle}`;
  try {
    let marketDetails;
    let lastError;
    for (const rpcUrl of [config.rpcUrl, ...(config.rpcFallbackUrls || [])]) {
      try {
        await probeRpc(rpcUrl);
        readProvider = new JsonRpcProvider(rpcUrl, config.chainId, { staticNetwork: true });
        pool = new Contract(config.pool, poolAbi, readProvider);
        oracle = new Contract(config.oracle, oracleAbi, readProvider);
        stable = new Contract(config.stable, erc20Abi, readProvider);
        collateral = new Contract(config.collateral, erc20Abi, readProvider);
        marketDetails = await timeout(Promise.all([
          pool.stable(), pool.collateral(), stable.decimals(), collateral.decimals(), stable.symbol(), collateral.symbol(),
          pool.baseBorrowLtvBps(), pool.liquidationLtvBps(), pool.closedSessionFactorBps(), pool.minFreshnessBps(), pool.minLiquidityBps(),
        ]), 10_000);
        activeRpcUrl = rpcUrl;
        break;
      } catch (error) {
        lastError = error;
        readProvider?.destroy();
      }
    }
    if (!marketDetails) throw lastError || new Error('No X Layer RPC responded');
    const [onchainStable, onchainCollateral, stablePlaces, collateralPlaces, stableName, collateralName, baseLtv, liquidationLtv, closedFactor, minFreshness, minLiquidity] = marketDetails;
    if (onchainStable.toLowerCase() !== config.stable.toLowerCase() || onchainCollateral.toLowerCase() !== config.collateral.toLowerCase()) {
      throw new Error('Deployment configuration does not match the pool contracts.');
    }
    stableDecimals = Number(stablePlaces);
    collateralDecimals = Number(collateralPlaces);
    underlyingDecimals = collateralDecimals;
    underlyingPerWhole = 10n ** BigInt(collateralDecimals);
    if (live) {
      const wrappedUnderlying = await pool.underlyingCollateral();
      const issuerToken = await collateral.asset();
      if (wrappedUnderlying.toLowerCase() !== config.underlyingCollateral.toLowerCase()
        || issuerToken.toLowerCase() !== config.underlyingCollateral.toLowerCase()) {
        throw new Error('Wrapper and pool underlying do not match deployment configuration.');
      }
      underlyingDecimals = Number(await new Contract(config.underlyingCollateral, erc20Abi, readProvider).decimals());
    }
    stableSymbol = stableName;
    collateralSymbol = collateralName;
    quoteParams = { baseLtv, closedFactor, minFreshness, minLiquidity };
    ui.marketName.textContent = `${collateralSymbol} / ${stableSymbol}`;
    ui.quoteLabel.textContent = `${collateralSymbol} amount`;
    ui.quoteDescription.textContent = `Enter a ${collateralSymbol} amount to compare its borrowing power when the reference market is open, closed, or unavailable. Values use the latest onchain oracle update and pool settings.`;
    ui.walletCollateralLabel.textContent = `Wallet ${collateralSymbol}`;
    ui.walletStableLabel.textContent = `Wallet ${stableSymbol}`;
    ui.baseLtvValue.textContent = pct(baseLtv);
    ui.liquidationLtvValue.textContent = pct(liquidationLtv);
    ui.quoteUnavailable.textContent = `0 ${stableSymbol}`;
    selectAction(selectedAction);
    await refresh();
    ui.connectButton.disabled = false;
    ui.connectButton.textContent = account ? short(account) : 'Connect wallet';
    window.setInterval(refresh, 20_000);
  } catch (error) {
    setMessage(`Could not initialize market: ${explain(error)}`, true);
    ui.marketPill.textContent = 'READ FAILURE';
    ui.marketPill.className = 'status-pill blocked';
    ui.quoteNote.textContent = 'Could not load current market data. Refresh the page to retry.';
    ui.refreshButton.disabled = false;
  }
}

setPending(false);
init();
