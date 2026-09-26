import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const rpcEndpoints = { '/rpc': 'https://testrpc.xlayer.tech', '/rpc/mainnet': 'https://rpc.xlayer.tech' };
const readMethods = new Set(['eth_chainId', 'eth_blockNumber', 'eth_call', 'eth_getBalance', 'eth_getCode', 'eth_getBlockByNumber', 'eth_getTransactionCount', 'eth_getLogs', 'eth_feeHistory', 'eth_gasPrice']);

async function proxyRpc(request, response, rpcEndpoint) {
  if (request.method !== 'POST') return response.writeHead(405).end('POST required');
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 131_072) return response.writeHead(413).end('RPC request too large');
  }
  try {
    const payload = JSON.parse(body);
    const calls = Array.isArray(payload) ? payload : [payload];
    if (!calls.length || calls.some((call) => !readMethods.has(call?.method))) {
      return response.writeHead(403).end('Read-only RPC methods only');
    }
    const upstream = await fetch(rpcEndpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
      signal: AbortSignal.timeout(10_000),
    });
    const result = await upstream.text();
    if (!upstream.ok) console.error(`Read RPC upstream HTTP ${upstream.status}`);
    response.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(result);
  } catch (error) {
    console.error(`Read RPC proxy failed: ${error.message}`);
    response.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'X Layer testnet RPC unavailable' }));
  }
}

const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (rpcEndpoints[pathname]) return void proxyRpc(request, response, rpcEndpoints[pathname]);
  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(root + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    if (!statSync(file).isFile()) throw new Error('Not a file');
    response.writeHead(200, { 'Content-Type': `${types[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

const port = Number(process.env.VADIUM_PORT || 4173);
server.listen(port, '127.0.0.1', () => console.log(`Vadium local build: http://127.0.0.1:${port}`));
