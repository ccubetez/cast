/**
 * Sign-in with wallet (server-side, auth для mutating endpoints).
 *
 * Flow: GET /api/auth/nonce → клиент подписывает message в кошельке →
 * POST /api/auth/session → сервер проверяет подпись (ed25519) →
 * выдаёт HMAC-токен (24h). Mutating endpoints проверяют токен и
 * связывают его с wallet в запросе — чужой адрес не подставить.
 *
 * Nonce: in-memory, single-use, TTL 5 мин (single-user локалка;
 * при росте — Redis).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { NextResponse } from 'next/server';

const NONCE_TTL_MS = 5 * 60_000;
const TOKEN_TTL_MS = 24 * 3600_000;
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const nonces = (() => {
  const g = globalThis as unknown as Record<string, Map<string, { nonce: string; at: number }> | undefined>;
  g['__castAuthNonces__'] ??= new Map();
  return g['__castAuthNonces__'];
})();

const MAX_NONCES = 5_000; // защита от раздувания памяти при флуде /nonce

function sweepNonces(): void {
  const now = Date.now();
  for (const [w, n] of nonces) {
    if (now - n.at >= NONCE_TTL_MS) nonces.delete(w);
  }
}

export function isValidWallet(wallet: unknown): wallet is string {
  return typeof wallet === 'string' && MINT_RE.test(wallet);
}

export function issueMessage(wallet: string): { message: string; nonce: string } {
  // чистим протухшие nonce + кап на размер Map (anti-flood)
  sweepNonces();
  if (nonces.size >= MAX_NONCES) throw new Error('too many pending nonces — try later');
  const now = Date.now();
  const nonce = randomBytes(16).toString('hex');
  nonces.set(wallet, { nonce, at: now });
  const message = [
    'SANCTUM-84 sign-in',
    `wallet: ${wallet}`,
    `nonce: ${nonce}`,
    `ts: ${new Date(now).toISOString()}`,
  ].join('\n');
  return { message, nonce };
}

/** Проверка подписи сообщения кошельком (single-use nonce). */
export function verifyWalletSignature(wallet: string, message: string, signatureB58: string): boolean {
  const stored = nonces.get(wallet);
  if (!stored || Date.now() - stored.at > NONCE_TTL_MS) return false;
  if (!message.includes(`nonce: ${stored.nonce}`) || !message.includes(`wallet: ${wallet}`)) return false;
  let sig: Uint8Array;
  let pub: Uint8Array;
  try {
    sig = bs58.decode(signatureB58);
    pub = bs58.decode(wallet);
  } catch {
    return false;
  }
  const ok = nacl.sign.detached.verify(new TextEncoder().encode(message), sig, pub);
  if (ok) nonces.delete(wallet); // single-use
  return ok;
}

// ── HMAC-токены ──

function secret(): string {
  const s = process.env['AUTH_SECRET'];
  if (!s) throw new Error('AUTH_SECRET not configured');
  return s;
}

interface TokenPayload {
  w: string; // wallet
  exp: number;
  n: string; // nonce
}

export function issueToken(wallet: string): { token: string; expiresAt: string } {
  const payload: TokenPayload = { w: wallet, exp: Date.now() + TOKEN_TTL_MS, n: randomBytes(8).toString('hex') };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret()).update(body).digest('hex');
  return { token: `v1.${body}.${sig}`, expiresAt: new Date(payload.exp).toISOString() };
}

export function verifyToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const body = parts[1] as string;
  const sig = parts[2] as string;
  const expected = createHmac('sha256', secret()).update(body).digest('hex');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenPayload;
    if (Date.now() > payload.exp || !isValidWallet(payload.w)) return null;
    return payload.w;
  } catch {
    return null;
  }
}

/** Извлечь wallet из Authorization: Bearer <token>. */
export function walletFromRequest(req: Request): string | null {
  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return null;
  return verifyToken(header.slice(7));
}

/**
 * Guard для mutating endpoints. null — доступ разрешён.
 * expectedWallet — связывает сессию с wallet из запроса (чужой не подставить).
 */
export function requireAuth(req: Request, expectedWallet?: string): NextResponse | null {
  const wallet = walletFromRequest(req);
  if (!wallet) {
    return NextResponse.json({ error: 'unauthorized — sign in with wallet (VERIFY in sidebar)' }, { status: 401 });
  }
  if (expectedWallet !== undefined && wallet !== expectedWallet) {
    return NextResponse.json({ error: 'wallet mismatch — session belongs to another wallet' }, { status: 403 });
  }
  return null;
}
