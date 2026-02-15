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
