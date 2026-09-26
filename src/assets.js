import { BrowserProvider, Contract, JsonRpcProvider, formatUnits, parseUnits } from '../vendor/ethers.min.js';
import { MARKETS, XLAYER } from './markets.js';
import { injectedWallet, switchWalletNetwork, assertWalletSession, watchWallet } from './wallet.js';

const ASSETS = MARKETS;
const EXPLORER = XLAYER.explorer;
const MAINNET_RPC = XLAYER.rpcUrl;
const tokenAbi = ['function symbol() view returns(string)', 'function decimals() view returns(uint8)', 'function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)', 'function approve(address,uint256) returns(bool)'];
const wrapperAbi = [...tokenAbi, 'function asset() view returns(address)', 'function convertToAssets(uint256) view returns(uint256)', 'function previewDeposit(uint256) view returns(uint256)', 'function previewRedeem(uint256) view returns(uint256)', 'function maxDeposit(address) view returns(uint256)', 'function maxRedeem(address) view returns(uint256)', 'function deposit(uint256,address) returns(uint256)', 'function redeem(uint256,address,address) returns(uint256)'];
const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries(['connectButton','creditDeskLink','assetTitle','assetState','tokenLink','wrapperLink','backingValue','rawBalance','shareBalance','wrapTab','unwrapTab','amountLabel','amountInput','maxButton','preview','actionButton','status','transactionLink'].map((id) => [id, $(id)]));
const requestedAsset = new URLSearchParams(window.location.search).get('asset');
let selected = Object.hasOwn(ASSETS, requestedAsset) ? requestedAsset : 'NVDAx';
let mode = 'wrap';
let readProvider;
let walletProvider;
let signer;
let account;
let rawToken;
let wrappedToken;
let rawDecimals = 18;
let shareDecimals = 18;
let rawBalance = 0n;
let shareBalance = 0n;
let maxDeposit = 0n;
let maxRedeem = 0n;
let verified = false;
let pending = false;
let connecting = false;
let activeWallet;
let stopWatchingWallet;
let previewValid = false;
let loadVersion = 0;
let previewVersion = 0;

const short = (value) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const quantity = (amount, decimals) => Number(formatUnits(amount, decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 });
const errorText = (error) => error?.code === 4001 || error?.code === 'ACTION_REJECTED' || /user rejected/i.test(error?.message || '')
  ? 'Wallet request cancelled.' : error?.shortMessage || error?.reason || error?.message || 'Request failed.';

function status(message, isError = false) {
  ui.status.textContent = message;
  ui.status.classList.toggle('error', isError);
}

function updateAction() {
  ui.actionButton.textContent = pending ? 'Waiting for confirmation…' : !account ? 'Connect wallet to continue' : mode === 'wrap' ? `Wrap ${selected}` : `Unwrap ${selected}`;
  ui.actionButton.disabled = pending || connecting || (!!account && (!verified || !previewValid));
  ui.maxButton.disabled = pending || !account || !verified;
  ui.connectButton.disabled = pending || connecting;
  ui.amountInput.readOnly = pending;
}

async function probe(url) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }), signal: AbortSignal.timeout(7000) });
  if (!response.ok || (await response.json()).result !== '0xc4') throw new Error('X Layer mainnet RPC is unavailable.');
}

async function getReadProvider() {
  if (readProvider) return readProvider;
  const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const urls = local ? ['/rpc/mainnet', MAINNET_RPC] : [MAINNET_RPC];
  let lastError;
  for (const url of urls) {
    try {
      await probe(url);
      readProvider = new JsonRpcProvider(new URL(url, window.location.href).href, 196, { staticNetwork: true, batchMaxCount: 1 });
      return readProvider;
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

async function loadAsset() {
  const version = ++loadVersion;
  ++previewVersion;
  verified = false;
  previewValid = false;
  rawToken = undefined;
  wrappedToken = undefined;
  ui.assetTitle.innerHTML = `${selected} <span>→</span> wrapped ${selected}`;
  ui.assetState.textContent = 'CHECKING CHAIN';
  ui.assetState.className = 'state';
  ui.backingValue.textContent = '—';
  ui.rawBalance.textContent = account ? 'Loading…' : 'Connect wallet';
  ui.shareBalance.textContent = account ? 'Loading…' : 'Connect wallet';
  ui.amountInput.value = '';
  ui.amountLabel.textContent = mode === 'wrap' ? `${selected} amount` : 'Wrapped shares to redeem';
  ui.preview.textContent = 'Enter an amount to see the onchain wrapper estimate.';
  ui.transactionLink.hidden = true;
  const entry = ASSETS[selected];
  ui.creditDeskLink.href = '/app.html';
  ui.tokenLink.href = `${EXPLORER}/address/${entry.token}`;
  ui.tokenLink.textContent = short(entry.token);
  ui.wrapperLink.href = `${EXPLORER}/address/${entry.wrapper}`;
  ui.wrapperLink.textContent = short(entry.wrapper);
  updateAction();
  try {
    const provider = await getReadProvider();
    const token = new Contract(entry.token, tokenAbi, provider);
    const wrapper = new Contract(entry.wrapper, wrapperAbi, provider);
    const underlying = await wrapper.asset();
    if (underlying.toLowerCase() !== entry.token) throw new Error('Wrapper asset() does not match the issuer token. Conversion is blocked.');
    const tokenCode = await provider.getCode(entry.token);
    const wrapperCode = await provider.getCode(entry.wrapper);
    if (tokenCode === '0x' || wrapperCode === '0x') throw new Error('Token or wrapper contract code is missing. Conversion is blocked.');
    const tokenSymbol = await token.symbol();
    const decimals = Number(await token.decimals());
    const wrapperDecimals = Number(await wrapper.decimals());
    if (version !== loadVersion) return;
    if (tokenSymbol.toLowerCase() !== selected.toLowerCase() || decimals > 36 || wrapperDecimals > 36) throw new Error('Unexpected issuer token metadata. Conversion is blocked.');
    rawDecimals = decimals;
    shareDecimals = wrapperDecimals;
    rawToken = token;
    wrappedToken = wrapper;
    const backing = await wrapper.convertToAssets(10n ** BigInt(shareDecimals));
    if (version !== loadVersion) return;
    if (backing <= 0n) throw new Error('Wrapper conversion is unavailable.');
    ui.backingValue.textContent = `1 share = ${quantity(backing, rawDecimals)} ${selected}`;
    ui.assetState.textContent = 'ONCHAIN VERIFIED';
    ui.assetState.className = 'state ready';
    verified = true;
    status(`${selected} and its V2 wrapper match on X Layer mainnet.`);
    await refreshBalances(version);
  } catch (error) {
    if (version !== loadVersion) return;
    verified = false;
    ui.assetState.textContent = 'READ FAILED';
    ui.assetState.className = 'state error';
    status(errorText(error), true);
  } finally { if (version === loadVersion) updateAction(); }
}

async function refreshBalances(version = loadVersion) {
  if (!verified || !account) return;
  const token = rawToken;
  const wrapper = wrappedToken;
  const symbol = selected;
  const [raw, shares, depositLimit, redeemLimit] = await Promise.all([
    token.balanceOf(account), wrapper.balanceOf(account), wrapper.maxDeposit(account), wrapper.maxRedeem(account),
  ]);
  if (version !== loadVersion) return;
  rawBalance = raw;
  shareBalance = shares;
  maxDeposit = depositLimit;
  maxRedeem = redeemLimit;
  ui.rawBalance.textContent = `${quantity(raw, rawDecimals)} ${symbol}`;
  ui.shareBalance.textContent = `${quantity(shares, shareDecimals)} shares`;
}

async function connect() {
  if (connecting || pending) return;
  const wallet = injectedWallet(window);
  if (!wallet) return status('No EVM wallet detected. Open this page in a browser with OKX Wallet or another EVM wallet.', true);
  try {
    connecting = true;
    updateAction();
    stopWatchingWallet?.();
    await wallet.request({ method: 'eth_requestAccounts' });
    await switchWalletNetwork(wallet, XLAYER);
    walletProvider = new BrowserProvider(wallet);
    signer = await walletProvider.getSigner();
    account = await signer.getAddress();
    activeWallet = wallet;
    await assertWalletSession(wallet, account, 196);
    stopWatchingWallet = watchWallet(wallet, () => window.location.reload());
    ui.connectButton.textContent = short(account);
    status('Wallet connected. Reading your token balances…');
    await refreshBalances();
    status('Wallet connected. Review the onchain estimate before converting.');
    await preview();
    updateAction();
  } catch (error) {
    account = undefined;
    signer = undefined;
    activeWallet = undefined;
    ui.connectButton.textContent = 'Connect wallet';
    ui.rawBalance.textContent = 'Connect wallet';
    ui.shareBalance.textContent = 'Connect wallet';
    status(errorText(error), true);
  }
  finally { connecting = false; updateAction(); }
}

async function preview() {
  const version = ++previewVersion;
  previewValid = false;
  updateAction();
  if (!verified || !ui.amountInput.value.trim()) return void (ui.preview.textContent = 'Enter an amount to see the onchain wrapper estimate.');
  let amount;
  try { amount = parseUnits(ui.amountInput.value.trim(), mode === 'wrap' ? rawDecimals : shareDecimals); }
  catch { return void (ui.preview.textContent = 'Enter a valid token amount.'); }
  if (amount <= 0n) return void (ui.preview.textContent = 'Enter an amount greater than zero.');
  ui.preview.textContent = 'Reading the current wrapper estimate…';
  try {
    const result = mode === 'wrap' ? await wrappedToken.previewDeposit(amount) : await wrappedToken.previewRedeem(amount);
    if (version !== previewVersion) return;
    if (result <= 0n) throw new Error('This amount rounds to zero. Enter a larger amount.');
    const available = mode === 'wrap' ? (rawBalance < maxDeposit ? rawBalance : maxDeposit) : (shareBalance < maxRedeem ? shareBalance : maxRedeem);
    if (account && amount > available) throw new Error('Amount exceeds your wallet balance or the wrapper limit.');
    previewValid = true;
    ui.preview.textContent = mode === 'wrap'
      ? `Estimated receipt: ${quantity(result, shareDecimals)} wrapped shares.`
      : `Estimated receipt: ${quantity(result, rawDecimals)} ${selected}.`;
  } catch (error) { if (version === previewVersion) ui.preview.textContent = `Preview unavailable: ${errorText(error)}`; }
  finally { if (version === previewVersion) updateAction(); }
}

async function execute() {
  if (pending || !verified || !signer || !account) return;
  let amount;
  try { amount = parseUnits(ui.amountInput.value.trim(), mode === 'wrap' ? rawDecimals : shareDecimals); }
  catch { return status('Enter a valid token amount.', true); }
  if (amount <= 0n) return status('Enter an amount greater than zero.', true);
  try {
    pending = true;
    updateAction();
    ui.transactionLink.hidden = true;
    await assertWalletSession(activeWallet, account, 196);
    if (await walletProvider.getBalance(account) === 0n) throw new Error('You need OKB on X Layer mainnet to pay transaction fees.');
    await refreshBalances();
    const available = mode === 'wrap' ? (rawBalance < maxDeposit ? rawBalance : maxDeposit) : (shareBalance < maxRedeem ? shareBalance : maxRedeem);
    if (amount > available) throw new Error('Amount exceeds your wallet balance or the wrapper limit.');
    const wrapperAddress = ASSETS[selected].wrapper;
    if (mode === 'wrap') {
      const allowance = await rawToken.allowance(account, wrapperAddress);
      if (allowance < amount) {
        status(`Approve exactly ${formatUnits(amount, rawDecimals)} ${selected} in your wallet…`);
        const approval = await rawToken.connect(signer).approve(wrapperAddress, amount);
        ui.transactionLink.href = `${EXPLORER}/tx/${approval.hash}`;
        ui.transactionLink.hidden = false;
        if ((await approval.wait())?.status !== 1) throw new Error('Token approval did not confirm.');
      }
    }
    await assertWalletSession(activeWallet, account, 196);
    const writeWrapper = wrappedToken.connect(signer);
    const estimated = mode === 'wrap' ? await writeWrapper.deposit.staticCall(amount, account) : await writeWrapper.redeem.staticCall(amount, account, account);
    if (estimated <= 0n) throw new Error('Wrapper conversion rounds to zero.');
    status(`Confirm ${mode === 'wrap' ? 'wrap' : 'unwrap'} in your wallet…`);
    const transaction = mode === 'wrap' ? await writeWrapper.deposit(amount, account) : await writeWrapper.redeem(amount, account, account);
    ui.transactionLink.href = `${EXPLORER}/tx/${transaction.hash}`;
    ui.transactionLink.hidden = false;
    status(`Transaction submitted: ${short(transaction.hash)}. Waiting for confirmation…`);
    if ((await transaction.wait())?.status !== 1) throw new Error('Transaction did not confirm. Check the explorer before retrying.');
    status(`Conversion confirmed: ${transaction.hash}`);
    ui.amountInput.value = '';
    await refreshBalances();
  } catch (error) { status(errorText(error), true); }
  finally { pending = false; updateAction(); void preview(); }
}

function selectMode(nextMode) {
  if (pending) return;
  mode = nextMode;
  ui.wrapTab.classList.toggle('active', mode === 'wrap');
  ui.unwrapTab.classList.toggle('active', mode === 'unwrap');
  ui.wrapTab.setAttribute('aria-selected', String(mode === 'wrap'));
  ui.unwrapTab.setAttribute('aria-selected', String(mode === 'unwrap'));
  ui.amountLabel.textContent = mode === 'wrap' ? `${selected} amount` : 'Wrapped shares to redeem';
  ui.amountInput.value = '';
  void preview();
}

document.querySelectorAll('[data-asset]').forEach((button) => button.addEventListener('click', () => {
  if (pending || selected === button.dataset.asset) return;
  selected = button.dataset.asset;
  const url = new URL(window.location.href);
  url.searchParams.set('asset', selected);
  window.history.replaceState(null, '', url);
  document.querySelectorAll('[data-asset]').forEach((item) => {
    const active = item.dataset.asset === selected;
    item.classList.toggle('selected', active);
    item.setAttribute('aria-pressed', String(active));
  });
  selectMode('wrap');
  void loadAsset();
}));
ui.wrapTab.addEventListener('click', () => selectMode('wrap'));
ui.unwrapTab.addEventListener('click', () => selectMode('unwrap'));
ui.amountInput.addEventListener('input', () => { void preview(); });
ui.maxButton.addEventListener('click', () => {
  const amount = mode === 'wrap' ? (rawBalance < maxDeposit ? rawBalance : maxDeposit) : (shareBalance < maxRedeem ? shareBalance : maxRedeem);
  ui.amountInput.value = formatUnits(amount, mode === 'wrap' ? rawDecimals : shareDecimals);
  void preview();
});
ui.connectButton.addEventListener('click', () => { void connect(); });
ui.actionButton.addEventListener('click', () => { if (account) void execute(); else void connect(); });
document.querySelectorAll('[data-asset]').forEach((item) => {
  const active = item.dataset.asset === selected;
  item.classList.toggle('selected', active);
  item.setAttribute('aria-pressed', String(active));
});
void loadAsset();
