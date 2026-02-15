import { JSON_CT } from './constants';
import { corsHeaders } from './cors';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export function json(req: Request, status: number, body: JsonValue): Response {
  const headers = new Headers(corsHeaders(req));
  headers.set('Content-Type', JSON_CT);
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorJson(req: Request, status: number, message: string): Response {
  return json(req, status, { error: message });
}
