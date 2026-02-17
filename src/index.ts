import { RESOURCES, UUID_RE, JWT_TTL_SECONDS, EMAIL_VERIFY_TTL_SECONDS, PASSWORD_RESET_TTL_SECONDS } from './constants';
import type { Env } from './types';
import { handleOptions } from './cors';
import { errorJson, json } from './http';
import { requireAuthSub } from './auth';
import { signJwt, verifyJwt } from './jwt';
import { hashPassword, verifyPassword } from './password';
import { getAccountResource, getDetails, getEmailIndex, keys, putAccountResource, putEmailIndex, defaultValue } from './storage';
import { readJson, validateDetails, validateEmailOnly, validateEmailPassword, validatePasswordResetConfirm, validateScore, validateStringArray, validateBoolMap, validateScorePatch, normalizeEmail } from './validate';
import { handleOauth } from './oauth';
import { sendMailSmtp } from './smtp';

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: any;
  const timeout = new Promise<T>((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

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

// --- One-time action tokens (email verify + password reset) ---

type ActionType = 'email_verify' | 'pw_reset';

function actionKey(typ: ActionType, jti: string): string {
  return `auth/action/${typ}/${jti}`;
}

async function putAction(env: Env, typ: ActionType, jti: string, userId: string, ttlSeconds: number): Promise<void> {
  await env.AUTH_KV.put(actionKey(typ, jti), userId, { expirationTtl: ttlSeconds });
}

async function takeAction(env: Env, typ: ActionType, jti: string): Promise<string | null> {
  const k = actionKey(typ, jti);
  const v = await env.AUTH_KV.get(k);
  if (!v) return null;
  await env.AUTH_KV.delete(k);
  return v;
}

async function issueActionToken(env: Env, typ: ActionType, userId: string, email: string, ttlSeconds: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const jti = crypto.randomUUID();
  await putAction(env, typ, jti, userId, ttlSeconds);
  return signJwt({ sub: userId, exp, iss: env.JWT_ISS, aud: env.JWT_AUD, typ, jti, email }, env.JWT_SECRET);
}

function mergeBoolMapIntoStringArray(existing: unknown, patch: Record<string, boolean>): string[] {
  const cur = Array.isArray(existing) ? existing.filter((x) => typeof x === 'string') : [];
  const set = new Set(cur);

  for (const [k, v] of Object.entries(patch)) {
    if (v) set.add(k);
    else set.delete(k);
  }

  return Array.from(set);
}

function mergeScore(existing: unknown, patch: Record<string, number | null>): Record<string, number> {
  const cur: Record<string, number> = {};

  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    for (const [k, v] of Object.entries(existing as Record<string, unknown>)) {
      if (typeof k !== 'string' || k.length > 256) continue;
      if (typeof v === 'number' && Number.isFinite(v)) cur[k] = v;
    }
  }

  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete cur[k];
    else cur[k] = v;
  }

  return cur;
}

async function handleAccountPost(req: Request, env: Env, userId: string, resource: (typeof RESOURCES)[number]): Promise<Response> {
  const sub = await requireAuthSub(req, env);
  if (sub !== userId) return errorJson(req, 403, 'Forbidden');

  const body = await readJson<any>(req);

  if (resource === 'favourites' || resource === 'sampled') {
    const patch = validateBoolMap(body, resource);
    const existing = await getAccountResource(env, userId, resource);
    const merged = mergeBoolMapIntoStringArray(existing ?? defaultValue(resource), patch);
    await putAccountResource(env, userId, resource, merged);
    return json(req, 200, { ok: true });
  }

  if (resource === 'score') {
    const patch = validateScorePatch(body); // number | null
    const existing = await getAccountResource(env, userId, 'score');
    const merged = mergeScore(existing ?? defaultValue('score'), patch);
    await putAccountResource(env, userId, 'score', merged);
    return json(req, 200, { ok: true });
  }

  return errorJson(req, 405, 'Method not allowed');
}

async function handleSignup(req: Request, env: Env): Promise<Response> {
  const STEP_MS = 15000;


  const body = await withTimeout(readJson<any>(req), STEP_MS, 'readJson');

  const { email, password } = validateEmailPassword(body);

  const existing = await withTimeout(getEmailIndex(env, email), STEP_MS, 'getEmailIndex');
  if (existing) return errorJson(req, 409, 'Email already exists');

  const userId = crypto.randomUUID();
  const pwHash = await withTimeout(hashPassword(password, env.PASSWORD_PEPPER), STEP_MS, 'hashPassword');

  await withTimeout(
    putEmailIndex(env, email, { userId, pwHash, createdAt: nowIso(), verified: false }),
    STEP_MS,
    'putEmailIndex'
  );

  await withTimeout(
    putAccountResource(env, userId, 'details', { public: false, createdAt: nowIso(), email, requiresVerify: true }),
    STEP_MS,
    'putAccountResource(details)'
  );
  await withTimeout(putAccountResource(env, userId, 'favourites', []), STEP_MS, 'putAccountResource(favourites)');
  await withTimeout(putAccountResource(env, userId, 'sampled', []), STEP_MS, 'putAccountResource(sampled)');
  await withTimeout(putAccountResource(env, userId, 'score', {}), STEP_MS, 'putAccountResource(score)');

  const token = await withTimeout(
    issueActionToken(env, 'email_verify', userId, email, EMAIL_VERIFY_TTL_SECONDS),
    STEP_MS,
    'issueActionToken'
  );

  const verifyUrl = new URL('/verify-email', new URL(req.url).origin);
  verifyUrl.searchParams.set('token', token);

  try {
    await withTimeout(
      sendMailSmtp(env, {
        to: email,
        subject: 'Verify your email',
        text:
          `Welcome!\n\n` +
          `Please verify your email to finish creating your account:\n\n` +
          `${verifyUrl.toString()}\n\n` +
          `This link expires in 24 hours.\n\n` +
          `If you didn't sign up, you can ignore this email.\n`,
      }),
      STEP_MS,
      'sendMailSmtp'
    );
  } catch (e: any) {
    // rollback best-effort
    try { await env.AUTH_KV.delete(keys.emailIndex(email)); } catch {}
    try { await env.AUTH_KV.delete(keys.acct(userId, 'details')); } catch {}
    try { await env.AUTH_KV.delete(keys.acct(userId, 'favourites')); } catch {}
    try { await env.AUTH_KV.delete(keys.acct(userId, 'sampled')); } catch {}
    try { await env.AUTH_KV.delete(keys.acct(userId, 'score')); } catch {}
    const msg = typeof e?.message === 'string' ? e.message : 'Failed to send verification email';
    return errorJson(req, 500, msg);
  }

  return json(req, 200, { ok: true, requiresVerify: true });
}


async function handleLogin(req: Request, env: Env): Promise<Response> {
  const body = await readJson<any>(req);
  const { email, password } = validateEmailPassword(body);

  const idx = await getEmailIndex(env, email);
  if (!idx) return errorJson(req, 401, 'Invalid email or password');
  if (!idx.pwHash) return errorJson(req, 401, 'Use OAuth login');

  // New: block until verified (only when explicitly false)
  if (idx.verified === false) return errorJson(req, 403, 'Email not verified');

  const ok = await verifyPassword(password, idx.pwHash, env.PASSWORD_PEPPER);
  if (!ok) return errorJson(req, 401, 'Invalid email or password');

  const token = await issueToken(env, idx.userId);
  return json(req, 200, { token, userId: idx.userId });
}

async function handleVerifyEmail(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const token = (url.searchParams.get('token') || '').trim();
  if (!token) return errorJson(req, 400, 'Invalid token');

  let p: any;
  try {
    p = await verifyJwt(token, env.JWT_SECRET, { iss: env.JWT_ISS, aud: env.JWT_AUD });
  } catch (e: any) {
    const msg = typeof e?.message === 'string' ? e.message : 'Invalid token';
    return errorJson(req, 400, msg);
  }

  const typ = String(p?.typ || '');
  const jti = String(p?.jti || '');
  const sub = String(p?.sub || '');
  const email = normalizeEmail(String(p?.email || ''));

  if (typ !== 'email_verify' || !jti || !sub || !email) return errorJson(req, 400, 'Invalid token');

  const stored = await takeAction(env, 'email_verify', jti);
  if (!stored || stored !== sub) return errorJson(req, 400, 'Invalid token');

  const idx = await getEmailIndex(env, email);
  if (!idx || idx.userId !== sub) return errorJson(req, 400, 'Invalid token');

  await putEmailIndex(env, email, { ...idx, verified: true, verifiedAt: nowIso() });

  const details = (await getDetails(env, sub)) ?? { public: false };
  await putAccountResource(env, sub, 'details', { ...details, email, requiresVerify: false, verifiedAt: nowIso() });

  // Redirect back to SPA login with a badge param
  return Response.redirect(`${'https://spirit.codexwilkes.com'}/#/login?verified=1`, 302);
}

async function handlePasswordResetRequest(req: Request, env: Env): Promise<Response> {
  const body = await readJson<any>(req);
  const { email } = validateEmailOnly(body);

  // Always return ok to avoid enumeration
  const idx = await getEmailIndex(env, email);

  // Only email/password accounts get reset links
  if (idx?.userId && idx.pwHash) {
    const token = await issueActionToken(env, 'pw_reset', idx.userId, email, PASSWORD_RESET_TTL_SECONDS);
    const resetLink = `${'https://spirit.codexwilkes.com'}/#/reset?token=${encodeURIComponent(token)}`;

    try {
      await sendMailSmtp(env, {
        to: email,
        subject: 'Reset your password',
        text:
          `A password reset was requested for your account.\n\n` +
          `Use this link to set a new password (expires in 30 minutes):\n\n` +
          `${resetLink}\n\n` +
          `If you didn't request this, you can ignore this email.\n`
      });
    } catch {
      // swallow: still return ok
    }
  }

  return json(req, 200, { ok: true });
}

async function handlePasswordResetConfirm(req: Request, env: Env): Promise<Response> {
  const body = await readJson<any>(req);
  const { token, password } = validatePasswordResetConfirm(body);

  let p: any;
  try {
    p = await verifyJwt(token, env.JWT_SECRET, { iss: env.JWT_ISS, aud: env.JWT_AUD });
  } catch (e: any) {
    const msg = typeof e?.message === 'string' ? e.message : 'Invalid token';
    return errorJson(req, 400, msg);
  }

  const typ = String(p?.typ || '');
  const jti = String(p?.jti || '');
  const sub = String(p?.sub || '');
  const email = normalizeEmail(String(p?.email || ''));

  if (typ !== 'pw_reset' || !jti || !sub || !email) return errorJson(req, 400, 'Invalid token');

  const stored = await takeAction(env, 'pw_reset', jti);
  if (!stored || stored !== sub) return errorJson(req, 400, 'Invalid token');

  const idx = await getEmailIndex(env, email);
  if (!idx || idx.userId !== sub) return errorJson(req, 400, 'Invalid token');

  const pwHash = await hashPassword(password, env.PASSWORD_PEPPER);

  // If user can reset via email, that's equivalent to mailbox verification.
  await putEmailIndex(env, email, { ...idx, pwHash, verified: true, verifiedAt: nowIso() });

  const details = (await getDetails(env, sub)) ?? { public: false };
  await putAccountResource(env, sub, 'details', { ...details, email, requiresVerify: false, verifiedAt: nowIso() });

  return json(req, 200, { ok: true });
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

  const oauth = await handleOauth(req, env);
  if (oauth) return oauth;

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

  if (pathname === '/verify-email') {
    if (req.method !== 'GET') return errorJson(req, 405, 'Method not allowed');
    return handleVerifyEmail(req, env);
  }

  if (pathname === '/password-reset/request') {
    if (req.method !== 'POST') return errorJson(req, 405, 'Method not allowed');
    return handlePasswordResetRequest(req, env);
  }

  if (pathname === '/password-reset/confirm') {
    if (req.method !== 'POST') return errorJson(req, 405, 'Method not allowed');
    return handlePasswordResetConfirm(req, env);
  }

  const acct = parseAccountRoute(pathname);
  if (acct) {
    if (req.method === 'GET') return handleAccountGet(req, env, acct.userId, acct.resource);
    if (req.method === 'PUT') return handleAccountPut(req, env, acct.userId, acct.resource);
    if (req.method === 'POST') return handleAccountPost(req, env, acct.userId, acct.resource);
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
      const status =
        msg.includes('Missing bearer token') || msg.includes('Invalid token') || msg.includes('Token expired') ? 401 :
        msg.includes('Expected application/json') || msg.includes('Invalid') || msg.includes('must') ? 400 :
        500;
      return errorJson(req, status, msg);
    }
  }
};
