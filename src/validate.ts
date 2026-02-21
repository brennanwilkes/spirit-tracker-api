// src/validate.ts

import type { Details, Score, EmailNotificationsV1, EmailRuleV1, EmailEventType, EmailEventPackV1, EmailPackEventV1, EmailPackSkuV1 } from "./types";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const MAX_TEXT = 64;        // shortlistName max length
const MAX_KEY = 256;        // max key length
const SKU_RE = /^[A-Za-z0-9:]+$/; // SKU format constraint

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RULES = 50;
const MAX_KW = 16;
const MAX_KW_LEN = 40;

const EVENT_TYPES: EmailEventType[] = ["OUT_OF_STOCK","PRICE_DROP","GLOBAL_NEW","GLOBAL_RETURN"];
const STORE_ID_RE = /^[a-z0-9_-]{1,64}$/;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function readJson<T = unknown>(req: Request): Promise<T> {
  const ct = req.headers.get("Content-Type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    throw new Error("Expected application/json");
  }
  return (await req.json()) as T;
}

function stripControls(s: string): string {
  return s.replace(/[\u0000-\u001F\u007F]/g, "");
}

function sanitizeUserText(s: string, maxLen: number): string {
  let out = String(s ?? "");
  out = out.normalize("NFKC");
  out = stripControls(out);
  out = out.trim().replace(/\s+/g, " ");
  return out.slice(0, maxLen);
}

function assertSku(value: unknown, name: string): string {
  const v = String(value ?? "").trim();
  if (!v || v.length > MAX_KEY || !SKU_RE.test(v)) {
    throw new Error(`${name} must be : + alphanumerics`);
  }
  return v;
}


/* -------------------------------------------------------------------------- */
/* Auth validation                                                            */
/* -------------------------------------------------------------------------- */

export function validateEmailPassword(body: any): { email: string; password: string } {
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !email.includes("@")) throw new Error("Invalid email");
  if (password.length < 8) throw new Error("Invalid password");

  return { email, password };
}

export function validateEmailOnly(body: any): { email: string } {
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
  if (!email || !email.includes("@")) throw new Error("Invalid email");
  return { email };
}

export function validatePasswordResetConfirm(body: any): { token: string; password: string } {
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!token || token.length < 20) throw new Error("Invalid token");
  if (password.length < 8) throw new Error("Invalid password");

  return { token, password };
}


// ////////////////

function sanitizeKeyword(s: unknown): string | null {
  const clean = sanitizeUserText(String(s ?? ""), MAX_KW_LEN);
  if (!clean) return null;
  return clean;
}

function uniqStrings(arr: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of arr) {
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function validateEmailRuleV1(x: any): EmailRuleV1 {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("emailNotifications.rules[] must be objects");

  const id = String(x.id || "").trim();
  if (!UUID_RE.test(id)) throw new Error("emailNotifications.rules[].id must be uuid");

  const enabled = x.enabled;
  if (typeof enabled !== "boolean") throw new Error("emailNotifications.rules[].enabled must be boolean");

  const scope = String(x.scope || "");
  if (scope !== "all" && scope !== "shortlist") throw new Error("emailNotifications.rules[].scope must be all|shortlist");

  const eventType = String(x.eventType || "") as EmailEventType;
  if (!EVENT_TYPES.includes(eventType)) throw new Error("emailNotifications.rules[].eventType invalid");

  const filtersIn = x.filters;
  let filters: EmailRuleV1["filters"] | undefined = undefined;

  if (filtersIn != null) {
    if (!filtersIn || typeof filtersIn !== "object" || Array.isArray(filtersIn)) {
      throw new Error("emailNotifications.rules[].filters must be object");
    }

    const kwAnyRaw = Array.isArray(filtersIn.keywordsAny) ? filtersIn.keywordsAny : [];
    const kwNoneRaw = Array.isArray(filtersIn.keywordsNone) ? filtersIn.keywordsNone : [];

    const kwAny = uniqStrings(
      kwAnyRaw.map(sanitizeKeyword).filter((v): v is string => !!v).slice(0, MAX_KW)
    );
    const kwNone = uniqStrings(
      kwNoneRaw.map(sanitizeKeyword).filter((v): v is string => !!v).slice(0, MAX_KW)
    );

    const out: any = {};
    if (kwAny.length) out.keywordsAny = kwAny;
    if (kwNone.length) out.keywordsNone = kwNone;

    // store filter
    if (filtersIn.storeId != null) {
      const s = String(filtersIn.storeId || "").trim();
      if (!s || !STORE_ID_RE.test(s)) throw new Error("storeId must be a small slug");
      out.storeId = s;
    }

    // across market (preserve false; default true for GLOBAL_NEW; not allowed for PRICE_DROP)
    if (filtersIn.acrossMarket != null) {
      if (typeof filtersIn.acrossMarket !== "boolean") throw new Error("acrossMarket must be boolean");
      out.acrossMarket = filtersIn.acrossMarket;
    }

    // Default: GLOBAL_NEW is across-market unless explicitly turned off
    if (eventType === "GLOBAL_NEW" && out.acrossMarket == null) {
      out.acrossMarket = true;
    }

    // PRICE_DROP doesn't use acrossMarket
    if (eventType === "PRICE_DROP") {
      delete out.acrossMarket;
    }

    if (eventType === "PRICE_DROP") {
      if (filtersIn.minDropAbs != null) {
        const n = Number(filtersIn.minDropAbs);
        if (!Number.isFinite(n) || n < 0 || n > 100000) throw new Error("minDropAbs must be number >= 0");
        out.minDropAbs = n;
      }
      if (filtersIn.minDropPct != null) {
        const n = Number(filtersIn.minDropPct);
        if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error("minDropPct must be number 0..100");
        out.minDropPct = n;
      }
      if (filtersIn.requireCheapestNow != null) {
        if (typeof filtersIn.requireCheapestNow !== "boolean") throw new Error("requireCheapestNow must be boolean");
        out.requireCheapestNow = filtersIn.requireCheapestNow;
      }
    }

    if (Object.keys(out).length) filters = out;
  }

  return { id, enabled, scope: scope as any, eventType, ...(filters ? { filters } : {}) };
}

function validateEmailNotificationsV1(v: any): EmailNotificationsV1 {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("details.emailNotifications must be an object");
  const version = Number(v.version);
  if (version !== 1) throw new Error("details.emailNotifications.version must be 1");

  const rulesIn = v.rules;
  if (!Array.isArray(rulesIn)) throw new Error("details.emailNotifications.rules must be an array");

  const rules: EmailRuleV1[] = [];
  const seen = new Set<string>();
  for (const r of rulesIn.slice(0, MAX_RULES)) {
    const rr = validateEmailRuleV1(r);
    if (seen.has(rr.id)) continue;
    seen.add(rr.id);
    rules.push(rr);
  }

  return { version: 1, rules };
}


/* -------------------------------------------------------------------------- */
/* Account resources                                                          */
/* -------------------------------------------------------------------------- */

export function validateDetails(body: any): Details {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("details must be an object");
  }

  if (typeof body.public !== "boolean") {
    throw new Error("details.public must be boolean");
  }

  if ("shortlistName" in body) {
    if (body.shortlistName == null) delete body.shortlistName;
    else if (typeof body.shortlistName !== "string") throw new Error("details.shortlistName must be a string");
    else {
      const clean = sanitizeUserText(body.shortlistName, MAX_TEXT);
      if (!clean) delete body.shortlistName;
      else body.shortlistName = clean;
    }
  }

  if ("emailNotifications" in body) {
    if (body.emailNotifications == null) {
      delete body.emailNotifications;
    } else {
      body.emailNotifications = validateEmailNotificationsV1(body.emailNotifications);
    }
  }

  return body as Details;
}
export function validateStringArray(body: any, name: string): string[] {
  if (!Array.isArray(body)) {
    throw new Error(`${name} must be an array`);
  }

  const out: string[] = [];
  for (const v of body) {
    out.push(assertSku(v, name));
  }

  return out;
}

export type BoolMap = Record<string, boolean>;

export function validateBoolMap(body: any, name: string): BoolMap {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`${name} must be an object`);
  }

  const out: Record<string, boolean> = {};

  for (const [k, v] of Object.entries(body)) {
    const key = assertSku(k, `${name} keys`);
    if (typeof v !== "boolean") {
      throw new Error(`${name} values must be boolean`);
    }
    out[key] = v;
  }

  return out;
}

export function validateScore(body: any): Score {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("score must be an object");
  }

  const out: Record<string, number> = {};

  for (const [k, v] of Object.entries(body)) {
    const key = assertSku(k, "score keys");
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error("score values must be numbers");
    }
    out[key] = v;
  }

  return out;
}

export type ScorePatch = Record<string, number | null>;

export function validateScorePatch(body: any): ScorePatch {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("score must be an object");
  }

  const out: Record<string, number | null> = {};

  for (const [k, v] of Object.entries(body)) {
    const key = assertSku(k, "score keys");

    if (v === null) {
      out[key] = null;
      continue;
    }

    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error("score values must be numbers or null");
    }

    out[key] = v;
  }

  return out;
}

export function validateEmailEventPackV1(body: any): EmailEventPackV1 {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("email event pack must be an object");
  }

  const version = Number(body.version);
  if (version !== 1) throw new Error("email event pack version must be 1");

  const generatedAt = typeof body.generatedAt === "string" ? body.generatedAt.trim() : "";
  if (!generatedAt) throw new Error("email event pack generatedAt must be string");

  const skusIn = body.skus;
  if (!skusIn || typeof skusIn !== "object" || Array.isArray(skusIn)) {
    throw new Error("email event pack skus must be an object");
  }

  const eventsIn = body.events;
  if (!Array.isArray(eventsIn)) {
    throw new Error("email event pack events must be an array");
  }

  const skus: Record<string, EmailPackSkuV1> = {};
  for (const [k0, v] of Object.entries(skusIn as Record<string, any>)) {
    const k = assertSku(k0, "skus keys");
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;

    const sku = assertSku(v.sku ?? k, "skus[].sku");
    const name = typeof v.name === "string" ? v.name.trim() : "";
    const img = typeof v.img === "string" ? v.img.trim() : "";

    const membersIn = Array.isArray(v.members) ? v.members : [];
    const members = membersIn
      .map((m: any) => {
        try { return assertSku(m, "skus[].members"); } catch { return ""; }
      })
      .filter(Boolean)
      .slice(0, 256);

    const pr = v.priceRangeNow;
    const priceRangeNow =
      pr && typeof pr === "object" && !Array.isArray(pr) &&
      typeof pr.min === "number" && Number.isFinite(pr.min) &&
      typeof pr.max === "number" && Number.isFinite(pr.max)
        ? { min: pr.min, max: pr.max }
        : null;

    const cn = v.cheapestNow;
    const cheapestNow =
      cn && typeof cn === "object" && !Array.isArray(cn) &&
      typeof cn.priceNum === "number" && Number.isFinite(cn.priceNum) &&
      Array.isArray(cn.storeIds)
        ? { priceNum: cn.priceNum, storeIds: cn.storeIds.filter((x: any) => typeof x === "string").slice(0, 64) }
        : null;

    const offersIn = Array.isArray(v.offersNow) ? v.offersNow : [];
    const offersNow = offersIn.slice(0, 256).map((o: any) => ({
      storeId: typeof o?.storeId === "string" ? o.storeId : "",
      storeLabel: typeof o?.storeLabel === "string" ? o.storeLabel : "",
      url: typeof o?.url === "string" ? o.url : "",
      price: typeof o?.price === "string" ? o.price : "",
      priceNum: typeof o?.priceNum === "number" && Number.isFinite(o.priceNum) ? o.priceNum : null,
    }));

    skus[k] = { sku, name, img, members, priceRangeNow, cheapestNow, offersNow };
  }

  const events: EmailPackEventV1[] = [];
  for (const e of eventsIn.slice(0, 50000)) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;

    const eventType = String(e.eventType || "") as EmailEventType;
    if (!EVENT_TYPES.includes(eventType)) continue;

    const id = typeof e.id === "string" ? e.id.trim() : "";
    const marketId = typeof e.marketId === "string" ? e.marketId.trim() : "";
    const sku = assertSku(e.sku, "events[].sku");

    const storeId = typeof e.storeId === "string" ? e.storeId.trim() : "";
    if (storeId && !STORE_ID_RE.test(storeId)) continue;

    const storeLabel = typeof e.storeLabel === "string" ? e.storeLabel : "";
    const listingUrl = typeof e.listingUrl === "string" ? e.listingUrl : "";

    const baseInStockCount = typeof e.baseInStockCount === "number" && Number.isFinite(e.baseInStockCount) ? e.baseInStockCount : 0;
    const headInStockCount = typeof e.headInStockCount === "number" && Number.isFinite(e.headInStockCount) ? e.headInStockCount : 0;

    const out: EmailPackEventV1 = {
      id,
      marketId,
      eventType,
      sku,
      storeId,
      storeLabel,
      listingUrl,
      marketNew: !!e.marketNew,
      marketReturn: !!e.marketReturn,
      marketOut: !!e.marketOut,
      baseInStockCount,
      headInStockCount,
    };

    if (eventType !== "PRICE_DROP") {
      if (typeof e.newPrice === "string") out.newPrice = e.newPrice;
    }

    if (eventType === "PRICE_DROP") {
      if (typeof e.oldPrice === "string") out.oldPrice = e.oldPrice;
      if (typeof e.newPrice === "string") out.newPrice = e.newPrice;
      if (typeof e.dropAbs === "number" && Number.isFinite(e.dropAbs)) out.dropAbs = e.dropAbs;
      if (typeof e.dropPct === "number" && Number.isFinite(e.dropPct)) out.dropPct = e.dropPct;
      else if (e.dropPct === null) out.dropPct = null;
      out.isCheapestNow = e.isCheapestNow === true;
    }

    events.push(out);
  }

  return {
    version: 1,
    generatedAt,
    range: body.range && typeof body.range === "object" && !Array.isArray(body.range)
      ? { fromSha: String(body.range.fromSha || ""), toSha: String(body.range.toSha || "") }
      : undefined,
    stats: body.stats,
    skus,
    events,
  };
}