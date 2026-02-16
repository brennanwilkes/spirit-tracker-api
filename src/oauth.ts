import { ALLOWED_ORIGIN, JWT_TTL_SECONDS } from './constants';
import type { Env } from './types';
import { errorJson } from './http';
import { signJwt } from './jwt';
import { bytesToB64Url } from './base64url';
import { getEmailIndex, putEmailIndex, putAccountResource } from './storage';
import { normalizeEmail } from './validate';

const STATE_TTL_SECONDS = 10 * 60;

function nowIso(): string {
  return new Date().toISOString();
}

function randState(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return bytesToB64Url(b);
}

function stateKey(provider: 'google' | 'github', state: string): string {
  return `oauth/state/${provider}/${state}`;
}

async function putState(env: Env, provider: 'google' | 'github', state: string): Promise<void> {
  await env.AUTH_KV.put(stateKey(provider, state), nowIso(), { expirationTtl: STATE_TTL_SECONDS });
}

async function takeState(env: Env, provider: 'google' | 'github', state: string): Promise<boolean> {
  const k = stateKey(provider, state);
  const v = await env.AUTH_KV.get(k);
  if (!v) return false;
  await env.AUTH_KV.delete(k);
  return true;
}

async function issueToken(env: Env, userId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + JWT_TTL_SECONDS;
  return signJwt({ sub: userId, exp, iss: env.JWT_ISS, aud: env.JWT_AUD }, env.JWT_SECRET);
}

async function getOrCreateUserIdByEmail(env: Env, emailRaw: string): Promise<string> {
  const email = normalizeEmail(emailRaw);
  const existing = await getEmailIndex(env, email);
  if (existing?.userId) return existing.userId;

  const userId = crypto.randomUUID();
  await putEmailIndex(env, email, { userId, createdAt: nowIso() });

  // Default account docs (same as signup)
  await putAccountResource(env, userId, 'details', { public: false, createdAt: nowIso() });
  await putAccountResource(env, userId, 'favourites', []);
  await putAccountResource(env, userId, 'sampled', []);
  await putAccountResource(env, userId, 'score', {});
  return userId;
}

function htmlRedirect(to: string): Response {
  const body = `<!doctype html><meta charset="utf-8"><script>location.replace(${JSON.stringify(to)});</script>`;
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function googleEmail(env: Env, code: string, redirectUri: string): Promise<string> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    }).toString()
  });

  const tokenJson: any = await tokenRes.json();
  if (!tokenRes.ok || typeof tokenJson?.access_token !== 'string') throw new Error('Invalid token');

  const uiRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` }
  });
  const ui: any = await uiRes.json();
  if (!uiRes.ok || typeof ui?.email !== 'string') throw new Error('Invalid email');
  if (ui.email_verified !== true) throw new Error('Email not verified');
  return ui.email;
}

async function githubEmail(env: Env, code: string, redirectUri: string, state: string): Promise<string> {
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      state
    }).toString()
  });

  const tokenJson: any = await tokenRes.json();
  if (!tokenRes.ok || typeof tokenJson?.access_token !== 'string') throw new Error('Invalid token');

  const emailsRes = await fetch('https://api.github.com/user/emails', {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      'User-Agent': 'spirit-tracker-api',
      'Accept': 'application/vnd.github+json'
    }
  });

  const emails: any = await emailsRes.json();
  if (!emailsRes.ok || !Array.isArray(emails)) throw new Error('Invalid email');

  const primaryVerified = emails.find((e: any) => e?.primary === true && e?.verified === true && typeof e?.email === 'string');
  const anyVerified = emails.find((e: any) => e?.verified === true && typeof e?.email === 'string');
  const picked = primaryVerified?.email ?? anyVerified?.email;
  if (!picked) throw new Error('No verified email');
  return picked;
}

export async function handleOauth(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  // /oauth/:provider/:action
  if (parts.length !== 3 || parts[0] !== 'oauth') return null;

  const provider = parts[1] as 'google' | 'github';
  const action = parts[2] as 'start' | 'callback';
  if ((provider !== 'google' && provider !== 'github') || (action !== 'start' && action !== 'callback')) {
    return errorJson(req, 404, 'Not found');
  }

  const origin = url.origin;
  const redirectUri = `${origin}/oauth/${provider}/callback`;

  if (req.method !== 'GET') return errorJson(req, 405, 'Method not allowed');

  if (action === 'start') {
    const state = randState();
    await putState(env, provider, state);

    if (provider === 'google') {
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', 'openid email');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('prompt', 'select_account');
      return Response.redirect(authUrl.toString(), 302);
    } else {
      const authUrl = new URL('https://github.com/login/oauth/authorize');
      authUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', 'read:user user:email');
      authUrl.searchParams.set('state', state);
      return Response.redirect(authUrl.toString(), 302);
    }
  }

  // callback
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  if (!code || !state) return errorJson(req, 400, 'Invalid callback');

  const ok = await takeState(env, provider, state);
  if (!ok) return errorJson(req, 400, 'Invalid state');

  const email =
    provider === 'google'
      ? await googleEmail(env, code, redirectUri)
      : await githubEmail(env, code, redirectUri, state);

  const userId = await getOrCreateUserIdByEmail(env, email);
  const token = await issueToken(env, userId);

  // send token to your SPA without putting it in server logs (fragment)
  return htmlRedirect(`${ALLOWED_ORIGIN}/oauth#token=${encodeURIComponent(token)}&userId=${encodeURIComponent(userId)}`);
}
