#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob
cd "$(dirname "$0")/.."

# Same naming rule as scripts/ensure-kv-and-patch.mjs. The account also holds other projects' namespaces,
# so the namespace is matched by title rather than taken from list order.
TITLE="$(sed -n 's/^name *= *"\(.*\)" *$/\1/p' wrangler.toml)-kv"

NS="$(npx wrangler kv namespace list | TITLE="$TITLE" node -e '
const all = JSON.parse(require("fs").readFileSync(0, "utf8"));
const hits = all.filter((n) => n.title === process.env.TITLE);
if (hits.length !== 1) throw new Error(`Expected one KV namespace titled ${process.env.TITLE}, found ${hits.length}`);
process.stdout.write(hits[0].id);
')"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

npx wrangler kv key list --namespace-id "$NS" --remote --prefix "auth/email/" > "$TMP/keys.json"

# The KV bulk get API accepts at most 100 keys per request.
node -e '
const fs = require("fs");
const dir = process.argv[1];
const names = JSON.parse(fs.readFileSync(`${dir}/keys.json`, "utf8")).map((k) => k.name);
for (let i = 0; i < names.length; i += 100) {
  fs.writeFileSync(`${dir}/chunk-${String(i / 100).padStart(4, "0")}.json`, JSON.stringify(names.slice(i, i + 100)));
}
' "$TMP"

for f in "$TMP"/chunk-*.json; do
  npx wrangler kv bulk get --namespace-id "$NS" --remote "$f" > "${f%.json}.out"
done

node -e '
const fs = require("fs");
const dir = process.argv[1];
const rows = [];
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".out")).sort()) {
  for (const [key, raw] of Object.entries(JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")))) {
    const text = typeof raw === "string" ? raw : raw?.value;
    if (typeof text !== "string") throw new Error(`No value returned for ${key}`);
    const idx = JSON.parse(text);
    if (typeof idx.userId !== "string" || typeof idx.createdAt !== "string") {
      throw new Error(`Malformed email index at ${key}: ${text}`);
    }
    // verified is absent on accounts created before email verification existed; the API treats only false as unverified.
    const verified = idx.verified === undefined ? "unset" : String(idx.verified);
    rows.push([idx.createdAt, verified, key.slice("auth/email/".length), idx.userId]);
  }
}
const expected = JSON.parse(fs.readFileSync(`${dir}/keys.json`, "utf8")).length;
if (rows.length !== expected) throw new Error(`Listed ${expected} keys but fetched ${rows.length} values`);
rows.sort((a, b) => a[0].localeCompare(b[0]));
console.log(["createdAt", "verified", "email", "userId"].join("\t"));
for (const r of rows) console.log(r.join("\t"));
console.error(`${rows.length} accounts`);
' "$TMP"
