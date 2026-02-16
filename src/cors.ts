import { ALLOWED_ORIGIN } from './constants';

export function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get('Origin');
  if (origin !== ALLOWED_ORIGIN) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,Cache-Control,Pragma',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

export function handleOptions(req: Request): Response {
  // CORS preflight
  const headers = corsHeaders(req);
  return new Response(null, { status: 204, headers });
}
