// src/validate.ts

import type { Details, Score } from "./types";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const MAX_TEXT = 64;        // shortlistName max length
const MAX_KEY = 256;        // max key length
const SKU_RE = /^[A-Za-z0-9:]+$/; // SKU format constraint


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

  // shortlistName (optional)
  if ("shortlistName" in body) {
    if (body.shortlistName == null) {
      delete body.shortlistName;
    } else if (typeof body.shortlistName !== "string") {
      throw new Error("details.shortlistName must be a string");
    } else {
      const clean = sanitizeUserText(body.shortlistName, MAX_TEXT);
      if (!clean) delete body.shortlistName;
      else body.shortlistName = clean;
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