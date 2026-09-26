export function injectedWallet(scope) {
  return [scope.okxwallet, scope.ethereum].find((candidate) => typeof candidate?.request === 'function');
}

export async function switchWalletNetwork(wallet, network) {
  const chainId = `0x${network.chainId.toString(16)}`;
  if (BigInt(await wallet.request({ method: 'eth_chainId' })) === BigInt(network.chainId)) return;
  try {
    await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (error) {
    const code = error?.code ?? error?.data?.originalError?.code;
    if (Number(code) !== 4902) throw error;
    await wallet.request({ method: 'wallet_addEthereumChain', params: [{
      chainId, chainName: network.chainId === 196 ? 'X Layer' : 'X Layer Testnet',
      nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
      rpcUrls: [network.walletRpcUrl || network.rpcUrl], blockExplorerUrls: [network.explorer],
    }] });
    await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  }
  if (BigInt(await wallet.request({ method: 'eth_chainId' })) !== BigInt(network.chainId)) {
    throw new Error('The wallet did not switch to the required X Layer network.');
  }
}

export async function assertWalletSession(wallet, account, chainId) {
  const accounts = await wallet.request({ method: 'eth_accounts' });
  const currentChain = await wallet.request({ method: 'eth_chainId' });
  if (accounts[0]?.toLowerCase() !== account.toLowerCase() || BigInt(currentChain) !== BigInt(chainId)) {
    throw new Error('Wallet account or network changed. Reconnect before continuing.');
  }
}

export function watchWallet(wallet, onChange) {
  wallet.on?.('accountsChanged', onChange);
  wallet.on?.('chainChanged', onChange);
  return () => {
    wallet.removeListener?.('accountsChanged', onChange);
    wallet.removeListener?.('chainChanged', onChange);
  };
}
