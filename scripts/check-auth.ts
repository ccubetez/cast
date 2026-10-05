/**
 * E2E тест auth (без Phantom): keypair → nonce → подпись → сессия →
 * mutating endpoints с/без токена и с чужим wallet.
 */
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const BASE = 'http://localhost:3100';

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function main() {
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const otherWallet = bs58.encode(nacl.sign.keyPair().publicKey);
  console.log('test wallet:', wallet.slice(0, 12) + '…');

  // 1. nonce
  const nonceRes = await fetch(`${BASE}/api/auth/nonce?wallet=${wallet}`);
  const { message } = (await nonceRes.json()) as { message: string };
  console.log('nonce ok:', message.includes(wallet));

  // 2. подпись + сессия
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
  const session = await post('/api/auth/session', { wallet, message, signature });
  const token = session.json['token'] as string;
  console.log('session:', session.status, '| token:', token.slice(0, 24) + '…');

  // 3. поддельная подпись → 401
  const bad = await post('/api/auth/session', { wallet, message, signature: bs58.encode(new Uint8Array(64)) });
  console.log('forged signature →', bad.status, bad.status === 401 ? '✓' : '✗ FAIL');

  // 4. replay того же nonce (single-use) → 401
  const replay = await post('/api/auth/session', { wallet, message, signature });
  console.log('nonce replay →', replay.status, replay.status === 401 ? '✓' : '✗ FAIL');

  const fakeCatch = {
    id: 'catch-real-authtest',
    publicId: 0,
    walletAddress: wallet,
    createdAt: new Date().toISOString(),
    closedAt: null,
    initialValueSol: 0.01,
    currentValueSol: 0.01,
    realizedValueSol: 0,
    status: 'ACTIVE',
    randomSeed: 'real-authtest',
    riskMode: 'SURFACE',
    positions: [],
  };

  // 5. без токена → 401
  const noAuth = await post('/api/catches', { catch: fakeCatch });
  console.log('mutating без токена →', noAuth.status, noAuth.status === 401 ? '✓' : '✗ FAIL');

  // 6. токен, но wallet в теле чужой → 403
  const mismatch = await post('/api/catches', { catch: { ...fakeCatch, walletAddress: otherWallet } }, token);
  console.log('чужой wallet в теле →', mismatch.status, mismatch.status === 403 ? '✓' : '✗ FAIL');

  // 7. токен + совпадающий wallet → 200
  const ok = await post('/api/catches', { catch: fakeCatch }, token);
  console.log('валидный токен+wallet →', ok.status, '| publicId:', ok.json['publicId'], ok.status === 200 ? '✓' : '✗ FAIL');

  // 8. sell endpoint: токен другого кошелька → 403
  const kp2 = nacl.sign.keyPair();
  const wallet2 = bs58.encode(kp2.publicKey);
  const n2 = await (await fetch(`${BASE}/api/auth/nonce?wallet=${wallet2}`)).json() as { message: string };
  const s2 = bs58.encode(nacl.sign.detached(new TextEncoder().encode(n2.message), kp2.secretKey));
  const sess2 = await post('/api/auth/session', { wallet: wallet2, message: n2.message, signature: s2 });
  const token2 = sess2.json['token'] as string;
  const sig = '3kZ' + 'b'.repeat(85);
  const sellForbidden = await post(`/api/catches/catch-real-authtest/sell`, { positionId: 'x', signature: sig, proceedsSol: 0.001 }, token2);
  console.log('sell чужого улова →', sellForbidden.status, sellForbidden.status === 403 ? '✓' : '✗ FAIL');

  // cleanup
  console.log('\nALL AUTH CHECKS DONE');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
