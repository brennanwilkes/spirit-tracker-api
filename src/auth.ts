import type { Env } from './types';
import { verifyJwt } from './jwt';

export function bearerToken(req: Request): string | null {
  const h = req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

export async function requireAuthSub(req: Request, env: Env): Promise<string> {
  const token = bearerToken(req);
  if (!token) throw new Error('Missing bearer token');
  const p = await verifyJwt(token, env.JWT_SECRET, { iss: env.JWT_ISS, aud: env.JWT_AUD });
  return p.sub;
}

// ---- GitHub Action HMAC auth for /email ----

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid signature');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  if (aHex.length !== bHex.length) return false;
  const a = hexToBytes(aHex);
  const b = hexToBytes(bHex);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacSha256Hex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function requireEmailPackHmac(req: Request, env: Env): Promise<void> {
  const secret = env.EMAIL_PACK_HMAC_SECRET;
  if (!secret) throw new Error('Unauthorized');

  const tsRaw = (req.headers.get('X-Spirit-Timestamp') || '').trim();
  const sigRaw = (req.headers.get('X-Spirit-Signature') || '').trim();

  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || ts <= 0) throw new Error('Unauthorized');

  // 5-minute window
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) throw new Error('Unauthorized');

  // Accept "v1=<hex>" or "<hex>"
  const provided = sigRaw.startsWith('v1=') ? sigRaw.slice(3) : sigRaw;
  if (!/^[0-9a-f]{64}$/i.test(provided)) throw new Error('Unauthorized');

  const bodyText = await req.clone().text();
  const expected = await hmacSha256Hex(secret, `${ts}.${bodyText}`);

  if (!timingSafeEqualHex(expected.toLowerCase(), provided.toLowerCase())) {
    throw new Error('Unauthorized');
  }
}