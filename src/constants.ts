export const ALLOWED_ORIGIN = 'https://spirit.codexwilkes.com';

export const JSON_CT = 'application/json; charset=utf-8';

export const JWT_TTL_SECONDS = 180 * 24 * 60 * 60; // 180 days

export const RESOURCES = ['details', 'favourites', 'sampled', 'score'] as const;
export type Resource = (typeof RESOURCES)[number];

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
