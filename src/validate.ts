import type { Details, Score } from './types';

export type BoolMap = Record<string, boolean>;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function readJson<T = unknown>(req: Request): Promise<T> {
  const ct = req.headers.get('Content-Type') || '';
  if (!ct.toLowerCase().includes('application/json')) {
    throw new Error('Expected application/json');
  }
  return (await req.json()) as T;
}

export function validateEmailPassword(body: any): { email: string; password: string } {
  const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || !email.includes('@')) throw new Error('Invalid email');
  if (password.length < 8) throw new Error('Invalid password');
  return { email, password };
}

export function validateDetails(body: any): Details {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('details must be an object');
  if (typeof body.public !== 'boolean') throw new Error('details.public must be boolean');
  return body as Details;
}

export function validateStringArray(body: any, name: string): string[] {
  if (!Array.isArray(body)) throw new Error(`${name} must be an array`);
  for (const v of body) {
    if (typeof v !== 'string' || v.length > 256) throw new Error(`${name} must be an array of small strings`);
  }
  return body;
}

export function validateScore(body: any): Score {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('score must be an object');
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(body)) {
    if (typeof k !== 'string' || k.length > 256) throw new Error('score keys must be small strings');
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('score values must be numbers');
    out[k] = v;
  }
  return out;
}

export function validateBoolMap(body: any, name: string): BoolMap {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(`${name} must be an object`);
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(body)) {
    if (typeof k !== 'string' || k.length < 1 || k.length > 256) throw new Error(`${name} keys must be small strings`);
    if (typeof v !== 'boolean') throw new Error(`${name} values must be boolean`);
    out[k] = v;
  }
  return out;
}

export function validateScorePatch(body: any): Score {
  // same shape/constraints as score, just semantic name for patch
  return validateScore(body);
}
