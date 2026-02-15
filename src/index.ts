import { RESOURCES, UUID_RE, JWT_TTL_SECONDS } from './constants';
import type { Env } from './types';
import { handleOptions } from './cors';
import { errorJson, json } from './http';
import { requireAuthSub } from './auth';
import { signJwt } from './jwt';
import { hashPassword, verifyPassword } from './password';
import { getAccountResource, getDetails, getEmailIndex, putAccountResource, putEmailIndex, defaultValue } from './storage';
import { readJson, validateDetails, validateEmailPassword, validateScore, validateStringArray } from './validate';

function nowIso(): string {
  return new Date().toISOString();
}

function trimTrailingSlashes(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/g, '') : path;
}

async function issueToken(env: Env, userId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + JWT_TTL_SECONDS;
  return signJwt({ sub: userId, exp, iss: env.JWT_ISS, aud: env.JWT_AUD }, env.JWT_SECRET);
}

async function handleSignup(req: Request, env: Env): Promise<Response> {
  const body = await readJson<any>(req);
  const { email, password } = validateEmailPassword(body);

  const existing = await getEmailIndex(env, email);
  if (existing) return errorJson(req, 409, 'Email already exists');

  const userId = crypto.randomUUID();
  const pwHash = await hashPassword(password, env.PASSWORD_PEPPER);

  await putEmailIndex(env, email, { userId, pwHash, createdAt: nowIso() });

  // Default account docs
  await putAccountResource(env, userId, 'details', { public: false, createdAt: nowIso() });
  await putAccountResource(env, userId, 'favourites', []);
  await putAccountResource(env, userId, 'sampled', []);
  await putAccountResource(env, userId, 'score', {});

  const token = await issueToken(env, userId);
  return json(req, 200, { token, userId });
}

async function handleLogin(req: Request, env: Env): Promise<Response> {
  const body = await readJson<any>(req);
  const { email, password } = validateEmailPassword(body);

  const idx = await getEmailIndex(env, email);
  if (!idx) return errorJson(req, 401, 'Invalid email or password');

  const ok = await verifyPassword(password, idx.pwHash, env.PASSWORD_PEPPER);
  if (!ok) return errorJson(req, 401, 'Invalid email or password');

  const token = await issueToken(env, idx.userId);
  return json(req, 200, { token, userId: idx.userId });
}

function parseAccountRoute(pathname: string): { userId: string; resource: (typeof RESOURCES)[number] } | null {
  const clean = trimTrailingSlashes(pathname);
  const parts = clean.split('/').filter(Boolean);
  if (parts.length !== 3) return null;
  if (parts[0] !== 'u') return null;
  const userId = parts[1];
  const resource = parts[2];
  if (!UUID_RE.test(userId)) return null;
  if (!RESOURCES.includes(resource as any)) return null;
  return { userId, resource: resource as any };
}

async function handleAccountGet(req: Request, env: Env, userId: string, resource: (typeof RESOURCES)[number]): Promise<Response> {
  const details = (await getDetails(env, userId)) ?? (defaultValue('details') as any);
  const isPublic = typeof details?.public === 'boolean' ? details.public : false;

  if (!isPublic) {
    const sub = await requireAuthSub(req, env);
    if (sub !== userId) return errorJson(req, 403, 'Forbidden');
  }

  const value = (await getAccountResource(env, userId, resource)) ?? defaultValue(resource);
  return json(req, 200, value as any);
}

async function handleAccountPut(req: Request, env: Env, userId: string, resource: (typeof RESOURCES)[number]): Promise<Response> {
  const sub = await requireAuthSub(req, env);
  if (sub !== userId) return errorJson(req, 403, 'Forbidden');

  const body = await readJson<any>(req);

  let value: unknown;
  switch (resource) {
    case 'details':
      value = validateDetails(body);
      break;
    case 'favourites':
      value = validateStringArray(body, 'favourites');
      break;
    case 'sampled':
      value = validateStringArray(body, 'sampled');
      break;
    case 'score':
      value = validateScore(body);
      break;
  }

  await putAccountResource(env, userId, resource, value);
  return json(req, 200, { ok: true });
}

async function router(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const pathname = trimTrailingSlashes(url.pathname);

  if (req.method === 'OPTIONS') return handleOptions(req);

  if (pathname === '' || pathname === '/') {
    if (req.method !== 'GET') return errorJson(req, 405, 'Method not allowed');
    return json(req, 200, { ok: true });
  }

  if (pathname === '/signup') {
    if (req.method !== 'POST') return errorJson(req, 405, 'Method not allowed');
    return handleSignup(req, env);
  }

  if (pathname === '/login') {
    if (req.method !== 'POST') return errorJson(req, 405, 'Method not allowed');
    return handleLogin(req, env);
  }

  const acct = parseAccountRoute(pathname);
  if (acct) {
    if (req.method === 'GET') return handleAccountGet(req, env, acct.userId, acct.resource);
    if (req.method === 'PUT') return handleAccountPut(req, env, acct.userId, acct.resource);
    return errorJson(req, 405, 'Method not allowed');
  }

  return errorJson(req, 404, 'Not found');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await router(req, env);
    } catch (err: any) {
      const msg = typeof err?.message === 'string' ? err.message : 'Internal error';
      const status = msg.includes('Missing bearer token') || msg.includes('Invalid token') || msg.includes('Token expired') ? 401 :
        msg.includes('Expected application/json') || msg.includes('Invalid') || msg.includes('must') ? 400 :
          500;
      return errorJson(req, status, msg);
    }
  }
};
