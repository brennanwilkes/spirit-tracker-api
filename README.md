# spirit-tracker-api (Cloudflare Worker + KV)

Small hobby API:

- Email + password signup/login
- Long-lived JWT auth (stateless, HS256)
- Single Cloudflare KV namespace for *all* data
- UUID account IDs
- `details.public` toggles unauthenticated GET access

## Endpoints

### Auth
- `POST /signup` → `{ email, password }` → `{ token, userId }`
- `POST /login` → `{ email, password }` → `{ token, userId }`

### Account resources
Route: `.../u/:uuid/:resource`

Resources:
- `details` (object, must include `public: boolean`)
- `favourites` (array of strings)
- `sampled` (array of strings)
- `score` (object map `{ "someKey": number }`)

Methods:
- `GET`:
  - if `details.public === true` → no JWT required
  - else → requires `Authorization: Bearer <JWT>` with `sub === :uuid`
- `PUT`:
  - always requires JWT with `sub === :uuid`
  - replaces the whole JSON blob

## KV layout (single namespace)

- Email index: `auth/email/<normalizedEmail>`
  - value: `{ userId, pwHash, createdAt }`
- Account data:
  - `acct/<uuid>/details`
  - `acct/<uuid>/favourites`
  - `acct/<uuid>/sampled`
  - `acct/<uuid>/score`

Email normalization: `trim()` + lowercase.

## Local dev

1. Install deps:
   ```bash
   npm install
   ```
2. Create `.dev.vars` from the example:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
3. Ensure KV namespace exists + patch `wrangler.toml` with IDs:
   ```bash
   export CLOUDFLARE_API_TOKEN=...
   export CLOUDFLARE_ACCOUNT_ID=...
   npm run kv:ensure
   ```
4. Run dev server:
   ```bash
   npm run dev
   ```

## GitHub Actions deploy

This repo includes an idempotent deploy workflow:

- installs deps
- ensures the KV namespace exists
- patches `wrangler.toml` with the namespace IDs
- deploys to `*.workers.dev`
- sets the Worker secret `JWT_SECRET`

### GitHub repository secrets

Required:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `JWT_SECRET` (static; changing it invalidates existing tokens)

## Notes

- Passwords are salted + PBKDF2-hashed.
- No refresh tokens, no token revocation.
- No password reset/change.
- No rate limiting.
