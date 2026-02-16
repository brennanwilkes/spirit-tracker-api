#!/usr/bin/env bash
set -euo pipefail

USER_ID="${1:?usage: $0 <user_uuid>}"

NS="$(npx wrangler kv namespace list | node -e '
const fs=require("fs");
let j=[]; try{j=JSON.parse(fs.readFileSync(0,"utf8"))}catch{}
process.stdout.write(j[0]?.id || "");
')"

[[ -n "$NS" ]] || { echo "No KV namespace found"; exit 1; }

for r in details favourites sampled score; do
  k="acct/${USER_ID}/${r}"
  echo "== $k"
  npx wrangler kv key get --namespace-id "$NS" --remote --text "$k" 2>/dev/null || echo "<missing>"
  echo
done
