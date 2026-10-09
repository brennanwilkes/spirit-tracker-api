export const ALLOWED_ORIGIN = 'https://spirit.codexwilkes.com';

export const JSON_CT = 'application/json; charset=utf-8';

// Sliding: clients renew via POST /auth/refresh, so only 30 days of disuse logs a user out.
export const JWT_TTL_SECONDS = 30 * 24 * 60 * 60;

export const EMAIL_VERIFY_TTL_SECONDS = 24 * 60 * 60; // 24h
export const PASSWORD_RESET_TTL_SECONDS = 30 * 60; // 30m

export const RESOURCES = ['details', 'favourites', 'sampled', 'score', 'stores'] as const;
export type Resource = (typeof RESOURCES)[number];

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
