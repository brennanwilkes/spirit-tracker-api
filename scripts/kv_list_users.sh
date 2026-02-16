#!/usr/bin/env bash
set -euo pipefail

NS="$(npx wrangler kv namespace list | node -e '
const fs=require("fs");
let j=[]; try{j=JSON.parse(fs.readFileSync(0,"utf8"))}catch{}
process.stdout.write(j[0]?.id || "");
')"

[[ -n "$NS" ]] || { echo "No KV namespace found"; exit 1; }

npx wrangler kv key list --namespace-id "$NS" --remote --prefix "auth/email/" \
| node -e '
const fs=require("fs"); let j=[]; try{j=JSON.parse(fs.readFileSync(0,"utf8"))}catch{}
for(const it of j){ const n=(typeof it==="string")?it:it?.name; if(n) console.log(n); }
' \
| while read -r key; do
  val="$(npx wrangler kv key get --namespace-id "$NS" --remote --text "$key" 2>/dev/null || true)"
  email="${key#auth/email/}"
  userId="$(node -e 'let j=null;try{j=JSON.parse(process.argv[1]||"")}catch{};process.stdout.write(j?.userId||"")' "$val")"
  echo -e "${email}\t${userId}"
done
