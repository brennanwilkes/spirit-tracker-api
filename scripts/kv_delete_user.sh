#!/usr/bin/env bash
set -euo pipefail

USER_ID="${1:?usage: $0 <user_uuid>}"

NS="$(npx wrangler kv namespace list | node -e '
const fs=require("fs");
let j=[]; try{j=JSON.parse(fs.readFileSync(0,"utf8"))}catch{}
process.stdout.write(j[0]?.id || "");
')"

[[ -n "$NS" ]] || { echo "No KV namespace found"; exit 1; }

# delete acct docs
for r in details favourites sampled score; do
  k="acct/${USER_ID}/${r}"
  npx wrangler kv key delete --namespace-id "$NS" --remote "$k" 2>/dev/null || true
  echo "deleted $k"
done

# delete auth/action/*
npx wrangler kv key list --namespace-id "$NS" --remote --prefix "auth/action/" \
| node -e '
const fs=require("fs"); let j=[]; try{j=JSON.parse(fs.readFileSync(0,"utf8"))}catch{}
for(const it of j){ const n=(typeof it==="string")?it:it?.name; if(n) console.log(n); }
' \
| while read -r k; do
    v="$(npx wrangler kv key get --namespace-id "$NS" --remote --text "$k" 2>/dev/null || true)"
    if [[ "$v" == "$USER_ID" ]]; then
      npx wrangler kv key delete --namespace-id "$NS" --remote "$k" 2>/dev/null || true
      echo "deleted $k"
    fi
  done

# delete auth/email/*
npx wrangler kv key list --namespace-id "$NS" --remote --prefix "auth/email/" \
| node -e '
const fs=require("fs"); let j=[]; try{j=JSON.parse(fs.readFileSync(0,"utf8"))}catch{}
for(const it of j){ const n=(typeof it==="string")?it:it?.name; if(n) console.log(n); }
' \
| while read -r k; do
    v="$(npx wrangler kv key get --namespace-id "$NS" --remote --text "$k" 2>/dev/null || true)"
    uid="$(node -e 'let j=null;try{j=JSON.parse(process.argv[1]||"")}catch{};process.stdout.write(j?.userId||"")' "$v")"
    if [[ "$uid" == "$USER_ID" ]]; then
      npx wrangler kv key delete --namespace-id "$NS" --remote "$k" 2>/dev/null || true
      echo "deleted $k"
    fi
  done
