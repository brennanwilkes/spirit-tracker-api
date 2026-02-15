import fs from 'node:fs/promises';
import path from 'node:path';

const API_BASE = 'https://api.cloudflare.com/client/v4';

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function cfFetch(url, init = {}) {
  const token = mustEnv('CLOUDFLARE_API_TOKEN');
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) {
    const msg = data?.errors?.[0]?.message || res.statusText;
    throw new Error(`Cloudflare API error (${res.status}): ${msg}`);
  }
  return data;
}

async function listNamespaces(accountId) {
  const url = `${API_BASE}/accounts/${accountId}/storage/kv/namespaces`;
  const data = await cfFetch(url);
  return Array.isArray(data.result) ? data.result : [];
}

async function createNamespace(accountId, title) {
  const url = `${API_BASE}/accounts/${accountId}/storage/kv/namespaces`;
  const data = await cfFetch(url, { method: 'POST', body: JSON.stringify({ title }) });
  return data.result;
}

async function ensureNamespace(accountId, title) {
  const all = await listNamespaces(accountId);
  const found = all.find((n) => n.title === title);
  if (found) return found;
  try {
    return await createNamespace(accountId, title);
  } catch (e) {
    // If a concurrent run created it, re-list.
    const all2 = await listNamespaces(accountId);
    const found2 = all2.find((n) => n.title === title);
    if (found2) return found2;
    throw e;
  }
}

function parseWorkerNameFromToml(tomlText) {
  const m = tomlText.match(/^\s*name\s*=\s*"([^"]+)"\s*$/m);
  return m?.[1] ?? null;
}

async function main() {
  const accountId = mustEnv('CLOUDFLARE_ACCOUNT_ID');
  const repoRoot = process.cwd();
  const wranglerPath = path.join(repoRoot, 'wrangler.toml');
  const wranglerToml = await fs.readFile(wranglerPath, 'utf8');

  const workerName = parseWorkerNameFromToml(wranglerToml) ?? 'worker';
  const title = process.env.KV_NAMESPACE_TITLE || `${workerName}-kv`;

  const ns = await ensureNamespace(accountId, title);

  const patched = wranglerToml.replace(/id\s*=\s*"__KV_ID__"/g, `id = "${ns.id}"`);
  await fs.writeFile(wranglerPath, patched, 'utf8');

  console.log(
    JSON.stringify(
      {
        workerName,
        kv: {
          title,
          id: ns.id
        }
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
