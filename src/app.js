import { BrowserProvider, Contract, JsonRpcProvider, formatUnits, parseUnits } from '../vendor/ethers.min.js';
import { calculateCoverage } from './coverage.js';
import { MARKETS, XLAYER } from './markets.js';

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
const erc20Abi = ['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function mint(address,uint256)', 'function asset() view returns (address)', 'function convertToAssets(uint256) view returns (uint256)', 'function previewDeposit(uint256) view returns (uint256)', 'function previewRedeem(uint256) view returns (uint256)', 'function maxDeposit(address) view returns (uint256)', 'function maxRedeem(address) view returns (uint256)', 'function deposit(uint256,address) returns (uint256)', 'function redeem(uint256,address,address) returns (uint256)'];

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
  'heroCopy','coverageState','currentLtvValue','liquidationPriceValue','liquidationBufferValue','coverageRail','coverageNote',
  'collateralPrep','prepHeading','wrapperLink','rawBalanceLabel','rawBalance','wrappedBalanceLabel','wrappedBalance',
  'wrapAmount','wrapMax','wrapPreview','wrapButton','unwrapAmount','unwrapMax','unwrapPreview','unwrapButton',
  'prepMessage','prepTransactionLink','connectionStatus','workspaceRoot','facilityNotice','facilityTitle','facilityCopy',
  'issuerTokenLink','facilityWrapperLink','facilityStableLink','assetIcon',
].map((id) => [id, $(id)]));

let provider;
let signer;
let account;
let pool;
let oracle;
let stable;
let collateral;
let underlying;
let writePool;
let writeStable;
let writeCollateral;
let writeUnderlying;
let stableDecimals = 18;
let collateralDecimals = 18;
let underlyingDecimals = 18;
let underlyingPerWhole = 10n ** 18n;
let stableSymbol = 'dUSD';
let collateralSymbol = 'AAPLx';
let underlyingSymbol = 'AAPLx';
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
let prepPreviewVersion = { wrap: 0, unwrap: 0 };
let prepValid = { wrap: false, unwrap: false };
let selectedMarket = 'demo';
let marketLoadVersion = 0;
let refreshTimer;

const short = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const number = (value, decimals, digits = 2) => Number(formatUnits(value, decimals)).toLocaleString(undefined, { maximumFractionDigits: digits });
const pct = (bps) => `${(Number(bps) / 100).toFixed(Number(bps) % 100 ? 1 : 0)}%`;
const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(value);
const configured = () => config && [config.pool, config.oracle, config.stable, config.collateral].every(isAddress);
const canMintDemo = () => selectedMarket === 'demo' && configured() && config.chainId === 1952 && config.demoAssets === true;
const liveMarket = () => selectedMarket === 'demo' && config?.chainId === 196 && config.marketMode === 'live'
  && config.demoAssets === false && isAddress(config.underlyingCollateral);
const isAssetDesk = () => Boolean(MARKETS[selectedMarket]);
const wrapMarket = () => liveMarket() || isAssetDesk();
const facilityDeployment = () => {
  const deployed = config?.facilities?.[selectedMarket];
  return deployed && isAddress(deployed.pool) ? deployed : null;
};
const writeEnabled = () => canMintDemo() || liveMarket();
const activeNetwork = () => isAssetDesk()
  ? { chainId: XLAYER.chainId, rpcUrl: XLAYER.rpcUrl, explorer: XLAYER.explorer, walletRpcUrl: XLAYER.rpcUrl }
  : { chainId: config.chainId, rpcUrl: config.rpcUrl, explorer: config.explorer, walletRpcUrl: config.walletRpcUrl || config.rpcUrl };
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
  if (Number.parseInt(body.result, 16) !== activeNetwork().chainId) throw new Error('RPC chain ID mismatch');
}

function setMessage(message, error = false) {
  ui.actionMessage.textContent = message;
  ui.actionMessage.style.color = error ? '#ff7a45' : '';
  ui.connectionStatus.textContent = message;
  ui.connectionStatus.classList.toggle('error', error);
}

function showTransaction(hash) {
  ui.transactionLink.hidden = !hash;
  if (hash) ui.transactionLink.href = `${activeNetwork().explorer}/tx/${hash}`;
}

function showPrepTransaction(hash) {
  ui.prepTransactionLink.hidden = !hash;
  if (hash) ui.prepTransactionLink.href = `${activeNetwork().explorer}/tx/${hash}`;
}

function setPrepMessage(message, error = false) {
  ui.prepMessage.textContent = message;
  ui.prepMessage.style.color = error ? '#ff7a45' : '';
}

function explain(error) {
  const name = error?.revert?.name || (() => {
    try { return pool?.interface?.parseError(error?.data)?.name; }
    catch { return undefined; }
  })();
  if (error?.code === 4001 || error?.code === 'ACTION_REJECTED' || /user rejected/i.test(error?.message || '')) return 'Wallet request cancelled. You can try again whenever you are ready.';
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
  ui.actionButton.textContent = value ? label : isAssetDesk() && !writeEnabled() ? 'Facility not deployed'
    : !writeEnabled() && activeNetwork().chainId === 196 ? 'Read-only deployment'
    : ({ deposit: `Deposit ${collateralSymbol}`, borrow: `Borrow ${stableSymbol}`, repay: `Repay ${stableSymbol}`, withdraw: `Withdraw ${collateralSymbol}`, supply: `Supply ${stableSymbol}`, redeem: 'Redeem liquidity shares' })[selectedAction];
  ui.mintStockButton.disabled = value || !account || !marketReady || !canMintDemo();
  ui.mintStableButton.disabled = value || !account || !marketReady || !canMintDemo();
  ui.wrapButton.disabled = value || !account || !marketReady || !wrapMarket() || !prepValid.wrap;
  ui.unwrapButton.disabled = value || !account || !marketReady || !wrapMarket() || !prepValid.unwrap;
  ui.wrapMax.disabled = value || !account || !marketReady || !wrapMarket();
  ui.unwrapMax.disabled = value || !account || !marketReady || !wrapMarket();
  ui.maxButton.disabled = value || !account || !marketReady || !writeEnabled();
  ui.refreshButton.disabled = value || refreshing || !pool;
  document.querySelectorAll('.tab').forEach((tab) => { tab.disabled = value; });
}

async function renderPrepPreview(kind) {
  if (!wrapMarket() || !collateral) return;
  const version = ++prepPreviewVersion[kind];
  const isWrap = kind === 'wrap';
  const field = isWrap ? ui.wrapAmount : ui.unwrapAmount;
  const output = isWrap ? ui.wrapPreview : ui.unwrapPreview;
  const decimals = isWrap ? underlyingDecimals : collateralDecimals;
  const raw = field.value.trim();
  prepValid[kind] = false;
  setPending(pending);
  if (!raw) {
    output.textContent = isWrap ? 'Enter an amount to preview wrapped shares.' : `Enter an amount to preview ${underlyingSymbol} returned.`;
    return;
  }
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    output.textContent = 'Enter a positive token amount.';
    return;
  }
  let amount;
  try { amount = parseUnits(raw, decimals); }
  catch { output.textContent = 'Too many decimal places for this token.'; return; }
  if (amount <= 0n) { output.textContent = 'Enter an amount greater than zero.'; return; }
  const available = isWrap ? snapshot.underlyingBalance : snapshot.collateralBalance;
  const maximum = isWrap ? snapshot.maxDeposit : snapshot.maxRedeem;
  if (!account || available === undefined || maximum === undefined) {
    output.textContent = account ? 'Wrapper balances are unavailable. Refresh to retry.' : 'Connect your wallet to check the available amount.';
    return;
  }
  if (amount > available || amount > maximum) {
    output.textContent = amount > available ? 'Amount exceeds your wallet balance.' : 'Amount exceeds the wrapper limit.';
    return;
  }
  output.textContent = 'Checking the current wrapper conversion…';
  try {
    const preview = isWrap ? await collateral.previewDeposit(amount) : await collateral.previewRedeem(amount);
    if (version !== prepPreviewVersion[kind]) return;
    if (preview <= 0n) throw new Error('Conversion rounds to zero.');
    output.textContent = isWrap
      ? `Estimated ${number(preview, collateralDecimals, 6)} ${collateralSymbol} shares received.`
      : `Estimated ${number(preview, underlyingDecimals, 6)} ${underlyingSymbol} returned.`;
    prepValid[kind] = true;
  } catch (error) {
    if (version !== prepPreviewVersion[kind]) return;
    output.textContent = `Could not preview conversion: ${explain(error)}`;
  }
  setPending(pending);
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
  const network = activeNetwork();
  const chainHex = `0x${network.chainId.toString(16)}`;
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] });
  } catch (error) {
    const unknownChain = error?.code === 4902 || /unrecognized chain|unknown chain|chain.*not added|chain.*does not exist/i.test(error?.message || '');
    if (!unknownChain) throw error;
    await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{
      chainId: chainHex,
      chainName: network.chainId === 196 ? 'X Layer' : 'X Layer Testnet',
      nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
      rpcUrls: [network.walletRpcUrl], blockExplorerUrls: [network.explorer],
    }] });
  }
}

async function connect() {
  if (!window.ethereum) return setMessage('No wallet detected. Open Vadium in a browser with OKX Wallet or another EVM wallet installed.', true);
  if (!isAssetDesk() && !configured()) return setMessage('Deployment addresses are not configured yet.', true);
  try {
    ui.connectButton.disabled = true;
    await ensureNetwork();
    provider = new BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    account = await signer.getAddress();
    if (pool) writePool = pool.connect(signer);
    if (stable) writeStable = stable.connect(signer);
    if (collateral) writeCollateral = collateral.connect(signer);
    if (wrapMarket() && underlying) writeUnderlying = underlying.connect(signer);
    ui.connectButton.textContent = short(account);
    ui.networkLabel.textContent = activeNetwork().chainId === 196 ? 'X Layer Mainnet' : 'X Layer Testnet';
    ui.marketName.textContent = `${collateralSymbol} / ${stableSymbol}`;
    setMessage(isAssetDesk() ? 'Wallet connected. Loading wrapper balances…' : pool ? 'Wallet connected. Loading your position…' : 'Wallet connected. Market data is still loading; use Refresh if it does not appear.');
    setPending(false);
    if (isAssetDesk()) await refreshAssetDesk();
    else if (pool) await refresh();
    if (marketReady) {
      setMessage(writeEnabled() ? 'Wallet connected. Your position is up to date.'
        : isAssetDesk() ? 'Wallet connected. You can wrap or unwrap the issuer token. Borrowing is not enabled.'
        : 'Wallet connected. This deployment is read-only.');
    }
  } catch (error) {
    setMessage(explain(error), true);
  } finally {
    ui.connectButton.disabled = false;
  }
}

async function refresh(force = false) {
  if (!configured() || !pool || refreshing || (pending && !force)) return;
  const version = marketLoadVersion;
  refreshing = true;
  ui.refreshButton.disabled = true;
  try {
    const [assets, poolDebt, nextMultiplier, riskResult, conversion, pauses] = await Promise.all([
      pool.totalAssets(), pool.totalDebt(), pool.creditMultiplierBps(), oracle.currentRisk(config.collateral),
      liveMarket() ? collateral.convertToAssets(10n ** BigInt(collateralDecimals)) : Promise.resolve(10n ** BigInt(collateralDecimals)),
      liveMarket() ? Promise.all([pool.borrowPaused(), pool.supplyPaused()]) : Promise.resolve([false, false]),
    ]);
    if (version !== marketLoadVersion || selectedMarket !== 'demo') return;
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
      const [collateralAmount, debt, capacity, stableBalance, collateralBalance, shares,
        prepState] = await Promise.all([
        pool.collateralOf(account), pool.debtOf(account), pool.borrowCapacity(account),
        stable.balanceOf(account), collateral.balanceOf(account), pool.liquidityShares(account),
        liveMarket() ? Promise.allSettled([
          underlying.balanceOf(account), collateral.maxDeposit(account), collateral.maxRedeem(account),
        ]) : Promise.resolve([]),
      ]);
      if (version !== marketLoadVersion || selectedMarket !== 'demo') return;
      const prepReadable = prepState.length === 3 && prepState.every((result) => result.status === 'fulfilled');
      const [underlyingBalance, maxDeposit, maxRedeem] = prepReadable ? prepState.map((result) => result.value) : [];
      snapshot = { collateralAmount, debt, capacity, assets, poolDebt, multiplier, stableBalance,
        collateralBalance, shares, underlyingBalance, maxDeposit, maxRedeem };
      ui.collateralValue.textContent = `${number(collateralAmount, collateralDecimals, 4)} ${collateralSymbol}`;
      ui.debtValue.textContent = `${number(debt, stableDecimals)} ${stableSymbol}`;
      ui.capacityValue.textContent = `${number(capacity > debt ? capacity - debt : 0n, stableDecimals)} ${stableSymbol}`;
      ui.walletCollateral.textContent = `${number(collateralBalance, collateralDecimals, 4)} ${collateralSymbol}`;
      ui.walletStable.textContent = `${number(stableBalance, stableDecimals, 4)} ${stableSymbol}`;
      ui.sharesValue.textContent = number(shares, stableDecimals, 4);
      if (liveMarket()) {
        ui.rawBalance.textContent = prepReadable ? `${number(underlyingBalance, underlyingDecimals, 6)} ${underlyingSymbol}` : '—';
        ui.wrappedBalance.textContent = prepReadable ? `${number(collateralBalance, collateralDecimals, 6)} ${collateralSymbol}` : '—';
        void renderPrepPreview('wrap');
        void renderPrepPreview('unwrap');
      }
      const underlyingAmount = collateralAmount * underlyingPerWhole / (10n ** BigInt(collateralDecimals));
      const valueUsd = available ? underlyingAmount * risk.price / (10n ** BigInt(underlyingDecimals)) : 0n;
      ui.positionValue.textContent = available ? number(valueUsd, 18) : '—';
      renderCoverage({ available, debt, capacity, underlyingAmount, price: risk.price });
    }
    marketReady = true;
    setPending(pending);
  } catch (error) {
    if (version !== marketLoadVersion || selectedMarket !== 'demo') return;
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
    renderCoverage();
    ui.updatedAt.textContent = 'READ FAILED';
    snapshot = {};
    if (liveMarket()) {
      ui.rawBalance.textContent = '—';
      ui.wrappedBalance.textContent = '—';
      prepValid = { wrap: false, unwrap: false };
    }
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
    if (version === marketLoadVersion && selectedMarket === 'demo') ui.refreshButton.disabled = pending || !pool;
  }
}

function renderCoverage(position) {
  const clear = () => {
    ui.currentLtvValue.textContent = '—';
    ui.liquidationPriceValue.textContent = '—';
    ui.liquidationBufferValue.textContent = '—';
    ui.coverageRail.style.width = '0%';
    ui.coverageRail.classList.remove('at-risk');
  };
  if (!position) {
    clear();
    ui.coverageState.textContent = account ? 'READ FAILURE' : 'CONNECT WALLET';
    ui.coverageState.classList.add('at-risk');
    ui.coverageNote.textContent = account
      ? 'Could not load your position. Refresh before making a credit decision.'
      : 'Connect your wallet to see the borrowing limit and liquidation buffer for your position.';
    return;
  }
  const { available, debt, capacity, underlyingAmount, price } = position;
  if (debt === 0n) {
    clear();
    ui.coverageState.textContent = underlyingAmount > 0n ? 'NO DEBT' : 'NO POSITION';
    ui.coverageState.classList.remove('at-risk');
    ui.coverageNote.textContent = underlyingAmount > 0n
      ? 'Your collateral is deposited and the credit line is unused.'
      : 'Deposit eligible collateral to open borrowing capacity.';
    return;
  }
  if (!available || underlyingAmount === 0n || price === 0n) {
    clear();
    ui.coverageState.textContent = 'PRICE UNAVAILABLE';
    ui.coverageState.classList.add('at-risk');
    ui.coverageNote.textContent = 'Current coverage cannot be computed. Repayment and collateral top-ups remain available.';
    return;
  }
  const { threshold, ltvBps, priceAtThreshold, buffer, usageBps, liquidatable } = calculateCoverage({
    debt, underlyingAmount, price, underlyingDecimals, stableDecimals,
    liquidationLtvBps: quoteParams.liquidationLtv,
  });
  ui.currentLtvValue.textContent = ltvBps === null ? '—' : pct(ltvBps);
  ui.liquidationPriceValue.textContent = priceAtThreshold === null ? '—' : `$${number(priceAtThreshold, 18, 2)}`;
  ui.liquidationBufferValue.textContent = `${number(buffer, stableDecimals, 2)} ${stableSymbol}`;
  ui.coverageRail.style.width = `${Math.min(Number(usageBps ?? 10_000n) / 100, 100)}%`;
  const atRisk = liquidatable || usageBps === null || usageBps >= 8_500n;
  ui.coverageRail.classList.toggle('at-risk', atRisk);
  ui.coverageState.classList.toggle('at-risk', atRisk);
  if (liquidatable) {
    ui.coverageState.textContent = 'LIQUIDATABLE';
    ui.coverageNote.textContent = 'Debt exceeds the hard threshold at the current oracle price. Add collateral or repay immediately.';
  } else if (usageBps === null || usageBps >= 8_500n) {
    ui.coverageState.textContent = 'NEAR THRESHOLD';
    ui.coverageNote.textContent = 'The buffer is narrow. Add collateral or repay to reduce liquidation risk.';
  } else if (debt > capacity) {
    ui.coverageState.textContent = 'NO NEW DRAW';
    ui.coverageNote.textContent = 'Current conditions reduce new credit. A smaller draw limit alone does not trigger liquidation.';
  } else {
    ui.coverageState.textContent = 'HEALTHY';
    ui.coverageNote.textContent = 'The displayed buffer uses the current oracle price. It can change before your next transaction.';
  }
}

async function approveIfNeeded(token, amount, spender = config.pool, report = setMessage, link = showTransaction) {
  const allowance = await token.allowance(account, spender);
  if (allowance >= amount) return;
  setPending(true, 'Approving…');
  report('Approve the exact amount in your wallet…');
  const approval = await token.approve(spender, amount);
  link(approval.hash);
  const receipt = await approval.wait();
  if (receipt?.status !== 1) throw new Error('Approval did not confirm successfully. Check the transaction before retrying.');
}

async function executePrep(kind) {
  if (!wrapMarket() || !account || !marketReady || pending || !prepValid[kind]) return;
  const isWrap = kind === 'wrap';
  const input = isWrap ? ui.wrapAmount : ui.unwrapAmount;
  const label = isWrap ? 'Wrap' : 'Unwrap';
  let amount;
  try { amount = parseUnits(input.value.trim(), isWrap ? underlyingDecimals : collateralDecimals); }
  catch { return setPrepMessage('Enter a valid token amount.', true); }
  if (amount <= 0n) return setPrepMessage('Enter an amount greater than zero.', true);
  try {
    setPending(true, `${label} in progress…`);
    showPrepTransaction();
    await checkWallet();
    const [balance, maximum] = isWrap
      ? await Promise.all([underlying.balanceOf(account), collateral.maxDeposit(account)])
      : await Promise.all([collateral.balanceOf(account), collateral.maxRedeem(account)]);
    if (amount > balance || amount > maximum) throw new Error('Amount exceeds your current balance or wrapper limit.');
    if (isWrap) {
      await approveIfNeeded(writeUnderlying, amount, await collateral.getAddress(), setPrepMessage, showPrepTransaction);
      await checkWallet();
    }
    const estimated = isWrap
      ? await writeCollateral.deposit.staticCall(amount, account)
      : await writeCollateral.redeem.staticCall(amount, account, account);
    if (estimated <= 0n) throw new Error('Wrapper conversion rounds to zero.');
    setPrepMessage(`${label} submitted to your wallet. Confirm the X Layer transaction…`);
    const transaction = isWrap
      ? await writeCollateral.deposit(amount, account)
      : await writeCollateral.redeem(amount, account, account);
    showPrepTransaction(transaction.hash);
    setPrepMessage(`${label} submitted: ${short(transaction.hash)}. Waiting for confirmation…`);
    const receipt = await transaction.wait();
    if (receipt?.status !== 1) throw new Error('Transaction did not confirm successfully. Check the explorer before retrying.');
    input.value = '';
    prepValid[kind] = false;
    setPrepMessage(`${label} confirmed: ${transaction.hash}`);
    if (isAssetDesk()) await refreshAssetDesk();
    else await refresh(true);
  } catch (error) {
    setPrepMessage(`${label} failed: ${explain(error)}`, true);
  } finally {
    setPending(false);
  }
}

async function checkWallet() {
  if (!signer || (await signer.getAddress()).toLowerCase() !== account.toLowerCase()) {
    throw new Error('The connected account changed. Reconnect your wallet before continuing.');
  }
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== activeNetwork().chainId) throw new Error('Switch your wallet back to the configured X Layer network.');
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
    borrow: !riskAvailable ? 'New borrowing is paused until the oracle publishes a current update. Existing positions can still be topped up or repaid.' : `Borrow ${stableSymbol} within your current limit. The limit can shrink when market conditions change.`,
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
ui.refreshButton.addEventListener('click', () => {
  if (isAssetDesk()) void refreshAssetDesk();
  else if (quoteParams) void refresh();
  else void init();
});
ui.quoteAmount.addEventListener('input', renderQuote);
ui.mintStockButton.addEventListener('click', () => mintDemo('stock'));
ui.mintStableButton.addEventListener('click', () => mintDemo('stable'));
ui.wrapAmount.addEventListener('input', () => { void renderPrepPreview('wrap'); });
ui.unwrapAmount.addEventListener('input', () => { void renderPrepPreview('unwrap'); });
ui.wrapMax.addEventListener('click', () => {
  const amount = snapshot.underlyingBalance < snapshot.maxDeposit ? snapshot.underlyingBalance : snapshot.maxDeposit;
  ui.wrapAmount.value = formatUnits(amount || 0n, underlyingDecimals);
  void renderPrepPreview('wrap');
});
ui.unwrapMax.addEventListener('click', () => {
  const amount = snapshot.collateralBalance < snapshot.maxRedeem ? snapshot.collateralBalance : snapshot.maxRedeem;
  ui.unwrapAmount.value = formatUnits(amount || 0n, collateralDecimals);
  void renderPrepPreview('unwrap');
});
ui.wrapButton.addEventListener('click', () => { void executePrep('wrap'); });
ui.unwrapButton.addEventListener('click', () => { void executePrep('unwrap'); });
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => selectAction(tab.dataset.action)));
document.querySelectorAll('.market-link[data-market]').forEach((button) => button.addEventListener('click', () => { void selectMarket(button.dataset.market); }));
document.querySelectorAll('[data-view-target]').forEach((button) => button.addEventListener('click', () => {
  const view = button.dataset.viewTarget;
  ui.workspaceRoot.dataset.view = view;
  document.querySelectorAll('[data-view-target]').forEach((item) => {
    const active = item.dataset.viewTarget === view;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  });
}));
window.ethereum?.on?.('accountsChanged', () => window.location.reload());
window.ethereum?.on?.('chainChanged', () => window.location.reload());

function resetContracts() {
  pool = undefined;
  oracle = undefined;
  stable = undefined;
  collateral = undefined;
  underlying = undefined;
  writePool = undefined;
  writeStable = undefined;
  writeCollateral = undefined;
  writeUnderlying = undefined;
  readProvider?.destroy?.();
  readProvider = undefined;
  marketReady = false;
  snapshot = {};
  quoteParams = undefined;
  currentRisk = undefined;
  riskAvailable = false;
  multiplier = 0n;
  operatorBorrowPaused = false;
  operatorSupplyPaused = false;
  prepValid = { wrap: false, unwrap: false };
}

async function refreshAssetDesk(version = marketLoadVersion) {
  if (!isAssetDesk() || !collateral || !underlying || !stable) return;
  try {
    const conversion = await timeout(collateral.convertToAssets(10n ** BigInt(collateralDecimals)), 8_000);
    if (version !== marketLoadVersion) return;
    if (conversion <= 0n) throw new Error('Wrapped collateral conversion is unavailable.');
    underlyingPerWhole = conversion;
    ui.sessionValue.textContent = 'NO FACILITY';
    ui.permissionValue.textContent = 'NOT DEPLOYED';
    ui.marketPill.textContent = 'WRAP ONLY';
    ui.marketPill.className = 'status-pill blocked';
    ui.freshnessValue.textContent = '—';
    ui.liquidityValue.textContent = '—';
    ui.multiplierValue.textContent = '—';
    for (const rail of [ui.freshnessRail, ui.liquidityRail, ui.multiplierRail]) rail.style.width = '0%';
    ui.poolLiquidity.textContent = '—';
    ui.poolDebt.textContent = '—';
    ui.baseLtvValue.textContent = '—';
    ui.liquidationLtvValue.textContent = '—';
    ui.updatedAt.textContent = facilityDeployment() ? 'POOL CONFIGURED / PAUSED' : 'NO CREDIT FACILITY';
    ui.riskExplanation.textContent = 'The issuer wrapper is verified on X Layer. New USDG credit is not available until a reviewed facility is deployed and unpaused.';
    ui.positionValue.textContent = '—';
    ui.collateralValue.textContent = '—';
    ui.debtValue.textContent = '—';
    ui.capacityValue.textContent = '—';
    ui.sharesValue.textContent = '—';
    renderCoverage();
    if (account) {
      const [raw, shares, cash, maxDeposit, maxRedeem] = await Promise.all([
        underlying.balanceOf(account), collateral.balanceOf(account), stable.balanceOf(account),
        collateral.maxDeposit(account), collateral.maxRedeem(account),
      ]);
      if (version !== marketLoadVersion) return;
      snapshot = {
        underlyingBalance: raw, collateralBalance: shares, stableBalance: cash,
        maxDeposit, maxRedeem, collateralAmount: 0n, debt: 0n, capacity: 0n, shares: 0n,
      };
      ui.walletCollateral.textContent = `${number(shares, collateralDecimals, 6)} ${collateralSymbol}`;
      ui.walletStable.textContent = `${number(cash, stableDecimals, 4)} ${stableSymbol}`;
      ui.rawBalance.textContent = `${number(raw, underlyingDecimals, 6)} ${underlyingSymbol}`;
      ui.wrappedBalance.textContent = `${number(shares, collateralDecimals, 6)} ${collateralSymbol}`;
      void renderPrepPreview('wrap');
      void renderPrepPreview('unwrap');
    } else {
      ui.walletCollateral.textContent = 'Connect wallet';
      ui.walletStable.textContent = 'Connect wallet';
      ui.rawBalance.textContent = 'Connect wallet';
      ui.wrappedBalance.textContent = 'Connect wallet';
    }
    marketReady = true;
    ui.refreshButton.disabled = false;
    setPending(pending);
  } catch (error) {
    if (version !== marketLoadVersion) return;
    marketReady = false;
    ui.marketPill.textContent = 'READ FAILED';
    ui.marketPill.className = 'status-pill blocked';
    setMessage(`Could not read wrapper state: ${explain(error)}`, true);
    setPending(pending);
  }
}

async function loadAssetDesk(symbol, version = marketLoadVersion) {
  const market = MARKETS[symbol];
  const network = activeNetwork();
  ui.facilityNotice.hidden = false;
  ui.facilityTitle.textContent = `${market.symbol} wrapper desk`;
  ui.facilityCopy.textContent = `${market.name} uses the issuer V2 wrapper on X Layer mainnet. Wrap shares in your own wallet. No Vadium USDG facility is open for this wrapper, so wrapping does not borrow.`;
  ui.issuerTokenLink.href = `${network.explorer}/address/${market.token}`;
  ui.issuerTokenLink.textContent = short(market.token);
  ui.facilityWrapperLink.href = `${network.explorer}/address/${market.wrapper}`;
  ui.facilityWrapperLink.textContent = short(market.wrapper);
  ui.facilityStableLink.href = `${network.explorer}/address/${XLAYER.usdg}`;
  ui.facilityStableLink.textContent = short(XLAYER.usdg);
  ui.environmentTitle.textContent = 'X Layer mainnet assets';
  ui.environmentCopy.textContent = 'These are the issuer token and current V2 wrapper. They are not demo faucets. A credit line against them is not open.';
  ui.heroCopy.textContent = `Wrap ${market.symbol} into the current non-rebasing wrapper. Collateral deposit and USDG borrowing stay disabled until a reviewed facility exists.`;
  ui.marketDescription.textContent = 'Issuer wrapper / no credit facility';
  ui.assetIcon.textContent = market.symbol.slice(0, 1);
  ui.collateralPrep.hidden = false;
  ui.startActions.hidden = true;
  ui.networkLabel.textContent = 'X Layer Mainnet';
  ui.marketName.textContent = `${market.symbol} wrapper / USDG`;
  ui.oracleLink.href = `${network.explorer}/address/${market.wrapper}`;
  setMessage(`Checking ${market.symbol} and its V2 wrapper on X Layer…`);
  try {
    const localPreview = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
    const rpcCandidates = localPreview ? ['/rpc/mainnet', network.rpcUrl] : [network.rpcUrl];
    let lastError;
    for (const rpcUrl of rpcCandidates) {
      try {
        await probeRpc(rpcUrl);
        if (version !== marketLoadVersion) return;
        readProvider = new JsonRpcProvider(new URL(rpcUrl, window.location.href).href, network.chainId, { staticNetwork: true, batchMaxCount: 1 });
        activeRpcUrl = new URL(rpcUrl, window.location.href).href;
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        readProvider?.destroy?.();
        readProvider = undefined;
      }
    }
    if (!readProvider) throw lastError || new Error('X Layer mainnet RPC did not respond');
    underlying = new Contract(market.token, erc20Abi, readProvider);
    collateral = new Contract(market.wrapper, erc20Abi, readProvider);
    stable = new Contract(XLAYER.usdg, erc20Abi, readProvider);
    const reads = [
      () => collateral.asset(), () => readProvider.getCode(market.token), () => readProvider.getCode(market.wrapper),
      () => underlying.symbol(), () => collateral.symbol(), () => underlying.decimals(), () => collateral.decimals(),
      () => stable.symbol(), () => stable.decimals(),
    ];
    const details = [];
    for (const read of reads) {
      details.push(await timeout(read(), 8_000));
      if (version !== marketLoadVersion) return;
    }
    const [asset, tokenCode, wrapperCode, tokenSymbol, wrapSymbol, tokenDecimals, wrapDecimals, usdgSymbol, usdgDecimals] = details;
    if (tokenCode === '0x' || wrapperCode === '0x') throw new Error('Token or wrapper code is missing on X Layer.');
    if (asset.toLowerCase() !== market.token) throw new Error('Wrapper asset() does not match the issuer token. Conversion is blocked.');
    if (tokenSymbol.toLowerCase() !== market.symbol.toLowerCase()) throw new Error('Unexpected issuer token symbol.');
    underlyingSymbol = tokenSymbol;
    collateralSymbol = wrapSymbol;
    stableSymbol = usdgSymbol;
    underlyingDecimals = Number(tokenDecimals);
    collateralDecimals = Number(wrapDecimals);
    stableDecimals = Number(usdgDecimals);
    ui.prepHeading.textContent = `Wrap ${underlyingSymbol} into the current V2 wrapper`;
    ui.wrapperLink.href = `${network.explorer}/address/${market.wrapper}`;
    ui.rawBalanceLabel.textContent = `Wallet ${underlyingSymbol}`;
    ui.wrappedBalanceLabel.textContent = `Wallet ${collateralSymbol}`;
    ui.wrapButton.textContent = `Wrap ${underlyingSymbol}`;
    ui.unwrapButton.textContent = `Unwrap ${collateralSymbol}`;
    document.querySelector('label[for="wrapAmount"]').textContent = `${underlyingSymbol} to wrap`;
    document.querySelector('label[for="unwrapAmount"]').textContent = `${collateralSymbol} shares to unwrap`;
    ui.walletCollateralLabel.textContent = `Wallet ${collateralSymbol}`;
    ui.walletStableLabel.textContent = `Wallet ${stableSymbol}`;
    ui.marketName.textContent = `${collateralSymbol} / ${stableSymbol}`;
    if (signer) {
      writeCollateral = collateral.connect(signer);
      writeUnderlying = underlying.connect(signer);
      writeStable = stable.connect(signer);
    }
    await refreshAssetDesk(version);
    if (version !== marketLoadVersion) return;
    ui.connectButton.disabled = false;
    ui.connectButton.textContent = account ? short(account) : 'Connect wallet';
    setMessage(account
      ? 'Wrapper verified on X Layer. Review the onchain estimate before converting.'
      : 'Issuer token and V2 wrapper match on X Layer. Connect a mainnet wallet to wrap.');
  } catch (error) {
    if (version !== marketLoadVersion) return;
    marketReady = false;
    ui.marketPill.textContent = 'READ FAILED';
    ui.marketPill.className = 'status-pill blocked';
    ui.connectButton.disabled = false;
    setMessage(`Could not verify ${symbol} on X Layer: ${explain(error)}`, true);
  }
}

async function selectMarket(id) {
  if (pending || id === selectedMarket) return;
  const version = ++marketLoadVersion;
  if (refreshTimer) window.clearInterval(refreshTimer);
  refreshTimer = undefined;
  selectedMarket = id;
  ui.workspaceRoot.dataset.market = id;
  document.querySelectorAll('.market-link[data-market]').forEach((item) => {
    const active = item.dataset.market === id;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  resetContracts();
  if (id === 'demo') return init(version);
  return loadAssetDesk(id, version);
}

async function init(version = ++marketLoadVersion) {
  if (!configured()) return setMessage('Contracts are not configured.', true);
  ui.facilityNotice.hidden = true;
  ui.assetIcon.textContent = 'A';
  ui.environmentTitle.textContent = 'Interactive testnet prototype';
  ui.environmentCopy.textContent = 'AAPLx and dUSD here are permissionless demo tokens with no real-world value. The separate USDG proof below uses real USDG on X Layer mainnet.';
  ui.heroCopy.textContent = 'Track collateral, available credit and repayment from one position workspace.';
  ui.startTitle.textContent = 'Get started on testnet';
  ui.startCopy.innerHTML = 'Connect a wallet on X Layer testnet. Mint demo AAPLx to borrow, or mint demo dUSD to supply liquidity. Need gas? <a href="https://web3.okx.com/xlayer/faucet" target="_blank" rel="noreferrer">Get testnet OKB ↗</a>';
  ui.startActions.hidden = false;
  ui.collateralPrep.hidden = true;
  ui.marketDescription.textContent = 'Isolated demo lending market';
  const live = liveMarket();
  if (live) {
    ui.heroCopy.textContent = 'Draw USDG against wrapped tokenized stocks. Track collateral coverage and repay without selling your position.';
    ui.environmentTitle.textContent = 'X Layer mainnet market';
    ui.environmentCopy.textContent = 'Transactions use real assets. Review the market risk state and contract addresses before depositing or supplying.';
    ui.startTitle.textContent = 'Use your X Layer assets';
    ui.startCopy.textContent = 'Connect your wallet, deposit supported collateral to borrow, or supply the stable asset to the pool. You need OKB for transaction fees.';
    ui.startActions.hidden = true;
    ui.mainnetProof.hidden = true;
    ui.marketDescription.textContent = 'Isolated mainnet lending market';
    ui.collateralPrep.hidden = false;
    ui.wrapperLink.href = `${config.explorer}/address/${config.collateral}`;
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
    const localPreview = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
    const rpcCandidates = [config.rpcUrl, ...(config.rpcFallbackUrls || [])]
      .filter((url) => localPreview || !url.startsWith('/'));
    if (localPreview && rpcCandidates.includes('/rpc')) {
      rpcCandidates.splice(rpcCandidates.indexOf('/rpc'), 1);
      rpcCandidates.unshift('/rpc');
    }
    for (const rpcUrl of rpcCandidates) {
      try {
        await probeRpc(rpcUrl);
        if (version !== marketLoadVersion) return;
        const providerUrl = new URL(rpcUrl, window.location.href).href;
        readProvider = new JsonRpcProvider(providerUrl, config.chainId, { staticNetwork: true, batchMaxCount: 1 });
        pool = new Contract(config.pool, poolAbi, readProvider);
        oracle = new Contract(config.oracle, oracleAbi, readProvider);
        stable = new Contract(config.stable, erc20Abi, readProvider);
        collateral = new Contract(config.collateral, erc20Abi, readProvider);
        const reads = [
          () => pool.stable(), () => pool.collateral(), () => stable.decimals(), () => collateral.decimals(),
          () => stable.symbol(), () => collateral.symbol(), () => pool.baseBorrowLtvBps(),
          () => pool.liquidationLtvBps(), () => pool.closedSessionFactorBps(),
          () => pool.minFreshnessBps(), () => pool.minLiquidityBps(),
        ];
        marketDetails = [];
        for (const read of reads) {
          marketDetails.push(await timeout(read(), 8_000));
          if (version !== marketLoadVersion) return;
        }
        activeRpcUrl = providerUrl;
        break;
      } catch (error) {
        lastError = error;
        marketDetails = undefined;
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
      underlying = new Contract(config.underlyingCollateral, erc20Abi, readProvider);
      [underlyingDecimals, underlyingSymbol] = await Promise.all([underlying.decimals(), underlying.symbol()]);
      underlyingDecimals = Number(underlyingDecimals);
    }
    stableSymbol = stableName;
    collateralSymbol = collateralName;
    if (live) {
      ui.prepHeading.textContent = `Wrap ${underlyingSymbol} for the market`;
      ui.rawBalanceLabel.textContent = `Wallet ${underlyingSymbol}`;
      ui.wrappedBalanceLabel.textContent = `Wallet ${collateralSymbol}`;
      ui.wrapButton.textContent = `Wrap ${underlyingSymbol}`;
      ui.unwrapButton.textContent = `Unwrap ${collateralSymbol}`;
      document.querySelector('label[for="wrapAmount"]').textContent = `${underlyingSymbol} to wrap`;
      document.querySelector('label[for="unwrapAmount"]').textContent = `${collateralSymbol} shares to unwrap`;
    }
    quoteParams = { baseLtv, liquidationLtv, closedFactor, minFreshness, minLiquidity };
    if (signer) {
      writePool = pool.connect(signer);
      writeStable = stable.connect(signer);
      writeCollateral = collateral.connect(signer);
      if (live) writeUnderlying = underlying.connect(signer);
    }
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
    if (version !== marketLoadVersion) return;
    ui.connectButton.disabled = false;
    ui.connectButton.textContent = account ? short(account) : 'Connect wallet';
    setMessage(!riskAvailable
      ? 'Market loaded. Oracle data is stale, so new borrowing is paused. Deposits and repayments remain available.'
      : account ? 'Wallet connected. Position loaded.' : 'Market loaded. Connect your wallet to start.');
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(refresh, 20_000);
  } catch (error) {
    if (version !== marketLoadVersion) return;
    setMessage(`Could not initialize market: ${explain(error)}`, true);
    ui.marketPill.textContent = 'READ FAILURE';
    ui.marketPill.className = 'status-pill blocked';
    ui.quoteNote.textContent = 'Could not load current market data. Refresh the page to retry.';
    ui.refreshButton.disabled = false;
    ui.connectButton.disabled = false;
  }
}

setPending(false);
init();
