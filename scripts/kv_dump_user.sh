#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

USER_ID="${1:?usage: $0 <user_uuid>}"

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

# Keep in sync with RESOURCES in src/constants.ts.
node -e '
const id = process.argv[1];
console.log(JSON.stringify(["details", "favourites", "sampled", "score", "stores"].map((r) => `acct/${id}/${r}`)));
' "$USER_ID" > "$TMP/keys.json"

npx wrangler kv bulk get --namespace-id "$NS" --remote "$TMP/keys.json" > "$TMP/values.json"

node -e '
const fs = require("fs");
const keys = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const values = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const k of keys) {
  if (!(k in values)) throw new Error(`Bulk get returned nothing for ${k}`);
  const raw = values[k];
  const text = raw === null || typeof raw === "string" ? raw : raw.value;
  console.log(`== ${k}`);
  console.log(text === null ? "<missing>" : JSON.stringify(JSON.parse(text), null, 2));
  console.log();
}
' "$TMP/keys.json" "$TMP/values.json"
