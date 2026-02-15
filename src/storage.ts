import type { EmailIndex, Details, Env, Score } from './types';
import type { Resource } from './constants';

export const keys = {
  emailIndex: (email: string) => `auth/email/${email}`,
  acct: (userId: string, resource: Resource) => `acct/${userId}/${resource}`
};

export async function kvGetJson<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const v = await kv.get(key, { type: 'json' });
  return (v as T | null) ?? null;
}

export async function kvPutJson(kv: KVNamespace, key: string, value: unknown): Promise<void> {
  await kv.put(key, JSON.stringify(value));
}

export async function getEmailIndex(env: Env, email: string): Promise<EmailIndex | null> {
  return kvGetJson<EmailIndex>(env.KV, keys.emailIndex(email));
}

export async function putEmailIndex(env: Env, email: string, idx: EmailIndex): Promise<void> {
  return kvPutJson(env.KV, keys.emailIndex(email), idx);
}

export async function getDetails(env: Env, userId: string): Promise<Details | null> {
  return kvGetJson<Details>(env.KV, keys.acct(userId, 'details'));
}

export async function putAccountResource(env: Env, userId: string, resource: Resource, value: unknown): Promise<void> {
  return kvPutJson(env.KV, keys.acct(userId, resource), value);
}

export async function getAccountResource(env: Env, userId: string, resource: Resource): Promise<unknown | null> {
  return kvGetJson<unknown>(env.KV, keys.acct(userId, resource));
}

export function defaultValue(resource: Resource): unknown {
  switch (resource) {
    case 'details':
      return { public: false };
    case 'favourites':
    case 'sampled':
      return [];
    case 'score':
      return {} as Score;
  }
}
