import type { Env } from './types';
import { json, errorJson } from './http';
import { requireEmailPackHmac } from './auth';
import { readJson } from './validate';

// Hosts we are willing to fetch on the tracker's behalf. The proxy exists ONLY
// to lend Cloudflare-egress IP reputation to scrapes that a GitHub-runner
// (Azure datacenter) IP gets challenged on — it is NOT a general open proxy, so
// the allowlist is deliberately tiny. A request to any other host is refused.
const PROXY_ALLOW_SUFFIXES = ['libertywinemerchants.com', 'coopwinespiritsbeer.com'];

// Request headers we must not forward verbatim — the runtime sets these itself,
// and forwarding a stale content-length / host corrupts the upstream request.
const STRIP_REQUEST_HEADERS = new Set(['host', 'content-length', 'connection', 'accept-encoding']);

function hostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  return PROXY_ALLOW_SUFFIXES.some((s) => h === s || h.endsWith('.' + s));
}

type ProxyRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
};

export async function handleProxy(req: Request, env: Env): Promise<Response> {
  // Same HMAC scheme as /email (signs `${ts}.${body}`) — reuses EMAIL_PACK_HMAC_SECRET.
  await requireEmailPackHmac(req, env);

  const spec = await readJson<ProxyRequest>(req);
  if (!spec || typeof spec.url !== 'string') return errorJson(req, 400, 'Missing url');

  let target: URL;
  try {
    target = new URL(spec.url);
  } catch {
    return errorJson(req, 400, 'Invalid url');
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return errorJson(req, 400, 'Bad protocol');
  if (!hostAllowed(target.hostname)) return errorJson(req, 403, `Host not allowed: ${target.hostname}`);

  const upstreamHeaders = new Headers();
  for (const [k, v] of Object.entries(spec.headers || {})) {
    if (!STRIP_REQUEST_HEADERS.has(k.toLowerCase())) upstreamHeaders.set(k, v);
  }

  const method = (spec.method || 'GET').toUpperCase();
  const init: RequestInit = { method, headers: upstreamHeaders, redirect: 'follow' };
  if (method !== 'GET' && method !== 'HEAD' && spec.body != null) init.body = spec.body;

  const upstream = await fetch(target.toString(), init);
  const bodyText = await upstream.text();

  // Pass everything back EXCEPT set-cookie (which we return as an array so the
  // tracker's cookie jar can round-trip multi-cookie responses faithfully).
  const headers: Record<string, string> = {};
  for (const [k, v] of upstream.headers) {
    if (k.toLowerCase() === 'set-cookie') continue;
    headers[k] = v;
  }
  // getSetCookie() is supported at runtime but missing from this workers-types version.
  const sc = (upstream.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const setCookie = typeof sc === 'function' ? sc.call(upstream.headers) : [];

  return json(req, 200, {
    status: upstream.status,
    finalUrl: upstream.url || spec.url,
    headers,
    setCookie,
    body: bodyText,
  });
}
