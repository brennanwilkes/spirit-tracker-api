// src/email_alert.ts
import type { EmailEventType } from "./types";

export type MatchedEmailEvent = {
  eventType: EmailEventType;

  sku: string;
  skuName: string;
  skuImg: string;

  storeLabel: string;

  marketNew: boolean;
  marketReturn: boolean;
  marketOut: boolean;

  oldPrice?: string;
  newPrice?: string;

  dropAbs?: number;
  dropPct?: number | null;

  isCheapestNow?: boolean;

  // optional future field (if you emit it separately)
  priceNow?: string;
};

export type EmailAlertJob = {
  userId: string;
  to: string;
  shortlistName: string; // unused
  eventCount: number; // unused
  events: MatchedEmailEvent[];
};

const REPO = "https://github.com/brennanwilkes/spirit-tracker";
const SITE = "https://spirit.codexwilkes.com";

function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function itemUrl(sku: string): string {
  return `${SITE}/#/item/${encodeURIComponent(String(sku || "").trim())}`;
}

function commitUrl(sha: string): string {
  return `${REPO}/commit/${encodeURIComponent(sha)}`;
}

function fmtPctWhole(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  return `${Math.round(Math.abs(n))}%`;
}

function fmtSaveAbsWhole(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  return `$${Math.round(n)}`;
}

/* ---------- Badges (light theme) ---------- */

function badge(text: string, tone: "good" | "bad" | "neutral" | "best" | "accent" = "neutral"): string {
  const base =
    "display:inline-block;font-size:11px;line-height:1;padding:6px 10px;border-radius:999px;border:1px solid #d6dde6;background:#f7f9fc;color:#44536a;margin:0 6px 0 0;white-space:nowrap;";
  const t =
    tone === "good"
      ? "border-color:rgba(42,165,90,0.30);background:rgba(42,165,90,0.08);color:rgba(42,120,70,1);"
      : tone === "bad"
        ? "border-color:rgba(200,80,80,0.30);background:rgba(200,80,80,0.08);color:rgba(150,40,40,1);"
        : tone === "best"
          ? "border-color:rgba(210,170,60,0.35);background:rgba(210,170,60,0.12);color:rgba(140,105,20,1);"
          : tone === "accent"
            ? "border-color:rgba(20,120,200,0.25);background:rgba(20,120,200,0.08);color:rgba(20,90,150,1);"
            : "";
  return `<span style="${base}${t}">${escHtml(text)}</span>`;
}

function eventBadge(ev: MatchedEmailEvent): { label: string; tone: "good" | "bad" | "neutral" | "accent" } {
  switch (ev.eventType) {
    case "PRICE_DROP":
      return { label: "ON SALE", tone: "good" };
    case "GLOBAL_NEW":
      return { label: "JUST LANDED", tone: "accent" };
    case "GLOBAL_RETURN":
      return { label: "BACK IN STOCK", tone: "accent" };
    case "OUT_OF_STOCK":
      return { label: "OUT OF STOCK", tone: "bad" };
    default:
      return { label: String(ev.eventType), tone: "neutral" };
  }
}

function computedBadge(ev: MatchedEmailEvent): { label: string; tone: "best" | "neutral" } | null {
  if (ev.isCheapestNow) return { label: "BEST PRICE", tone: "best" };
  if (ev.marketNew) return { label: "NEW TO MARKET", tone: "neutral" };
  if (ev.marketReturn) return { label: "MARKET RETURN", tone: "neutral" };
  if (ev.marketOut) return { label: "ACROSS MARKET", tone: "neutral" };
  return null;
}

function pickBadges(ev: MatchedEmailEvent): string[] {
  const out: string[] = [];
  const eb = eventBadge(ev);
  out.push(badge(eb.label, eb.tone));

  const cb = computedBadge(ev);
  if (cb) out.push(badge(cb.label, cb.tone));

  // cap to avoid wrapping in iOS Mail
  return out.slice(0, 2);
}

/* ---------- Grouping ---------- */

function groupTitle(t: EmailEventType): string {
  if (t === "PRICE_DROP") return "On sale";
  if (t === "GLOBAL_NEW") return "Just landed";
  if (t === "GLOBAL_RETURN") return "Back in stock";
  if (t === "OUT_OF_STOCK") return "Out of stock";
  return String(t);
}

/* ---------- Summary blurb (one flowing paragraph) ---------- */

function getBrandHeuristic(name: string): string {
  const s = String(name || "").trim();
  if (!s) return "";
  const words = s
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  const stop = new Set([
    "single",
    "malt",
    "whisky",
    "whiskey",
    "bourbon",
    "rye",
    "cask",
    "reserve",
    "edition",
    "batch",
    "bottle",
    "proof",
    "year",
    "years",
    "yr",
    "yo",
    "ml",
  ]);

  const out: string[] = [];
  for (const w of words) {
    if (/\d/.test(w)) break;
    const lw = w.toLowerCase();
    if (stop.has(lw) && out.length >= 1) break;
    out.push(w);
    if (out.length >= 3) break;
  }
  return out.join(" ").trim();
}

function joinHumanList(xs: string[]): string {
  const arr = xs.map((x) => String(x).trim()).filter(Boolean);
  if (!arr.length) return "";
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(", ")}, and ${arr[arr.length - 1]}`;
}

function buildSummaryParagraph(events: MatchedEmailEvent[], total: number): { html: string; text: string } {
  const evs = Array.isArray(events) ? events : [];

  // Best deal heuristic: prefer highest % then $.
  let bestDeal: MatchedEmailEvent | null = null;
  let bestPct = -1;
  let bestAbs = -1;

  const storeNew = new Map<string, number>();
  const storeReturn = new Map<string, number>();
  const brands = new Map<string, number>();

  for (const ev of evs) {
    // stores
    const store = String(ev.storeLabel || "").trim();
    if (store) {
      if (ev.eventType === "GLOBAL_NEW") storeNew.set(store, (storeNew.get(store) || 0) + 1);
      if (ev.eventType === "GLOBAL_RETURN") storeReturn.set(store, (storeReturn.get(store) || 0) + 1);
    }

    // brands
    const b = getBrandHeuristic(String(ev.skuName || ""));
    if (b) brands.set(b, (brands.get(b) || 0) + 1);

    // best deal
    if (ev.eventType === "PRICE_DROP") {
      const pct = typeof ev.dropPct === "number" && Number.isFinite(ev.dropPct) ? Math.abs(ev.dropPct) : -1;
      const abs = typeof ev.dropAbs === "number" && Number.isFinite(ev.dropAbs) ? ev.dropAbs : -1;
      const better = pct > bestPct || (pct === bestPct && abs > bestAbs);
      if (better) {
        bestDeal = ev;
        bestPct = pct;
        bestAbs = abs;
      }
    }
  }

  const topStores = (m: Map<string, number>, n: number) =>
    Array.from(m.entries())
      .map(([k, v]) => ({ k, v }))
      .sort((a, b) => b.v - a.v || a.k.localeCompare(b.k))
      .slice(0, n);

  const newStores = topStores(storeNew, 3).map((x) => x.k);
  const returnStores = topStores(storeReturn, 3).map((x) => x.k);
  const topBrands = Array.from(brands.entries())
    .map(([k, v]) => ({ k, v }))
    .sort((a, b) => b.v - a.v || a.k.localeCompare(b.k))
    .slice(0, 3)
    .map((x) => x.k);

  const sentences: string[] = [];

  if (total > 10) {
    sentences.push(`Here’s a quick skim before you dive in.`);
    if (bestDeal) {
      const name = bestDeal.skuName || `(SKU ${bestDeal.sku})`;
      const store = String(bestDeal.storeLabel || "").trim();
      const oldP = String(bestDeal.oldPrice || "").trim();
      const newP = String(bestDeal.newPrice || "").trim();
      const saveAbs = fmtSaveAbsWhole(bestDeal.dropAbs);
      const savePct = fmtPctWhole(bestDeal.dropPct);
      const save = [saveAbs, savePct ? `(${savePct})` : ""].filter(Boolean).join(" ");
      const priceBit =
        oldP && newP ? `${oldP} → ${newP}` : newP ? `now ${newP}` : "";
      const storeBit = store ? ` at ${store}` : "";
      const bestBit = bestDeal.isCheapestNow ? ` — and it’s the best price right now.` : ".";
      const core = `The best-looking deal is ${name}${storeBit}${priceBit ? ` (${priceBit})` : ""}${save ? `, saving ${save}` : ""}`;
      sentences.push(core + bestBit);
    }
    if (newStores.length) {
      sentences.push(`New bottles showed up at ${joinHumanList(newStores)}.`);
    }
    if (returnStores.length) {
      sentences.push(`A few things also came back in stock at ${joinHumanList(returnStores)}.`);
    }
    if (topBrands.length) {
      sentences.push(`Notables in this batch include ${joinHumanList(topBrands)}.`);
    }
    sentences.push(`Tap any bottle to open it, and scroll to the bottom for the full report.`);
  } else {
    sentences.push(`Tap any bottle to open it, and scroll to the bottom for the full report.`);
  }

  const paragraph = sentences.join(" ").replace(/\s+/g, " ").trim();

  const html = `
<div style="margin:0 0 12px;font-size:13px;color:#475569;line-height:1.6;">
  ${escHtml(paragraph)}
</div>
  `.trim();

  return { html, text: paragraph };
}

/* ---------- Price rendering ---------- */

function renderPriceHtml(ev: MatchedEmailEvent): string {
  // PRICE DROP: wrap "Save ..." onto its own line
  if (ev.eventType === "PRICE_DROP") {
    const oldP = String(ev.oldPrice || "").trim();
    const newP = String(ev.newPrice || "").trim();

    const saveAbs = fmtSaveAbsWhole(ev.dropAbs);
    const savePct = fmtPctWhole(ev.dropPct);

    const wasNow =
      oldP && newP
        ? `Was <span style="color:#66758a;">${escHtml(oldP)}</span> → Now <span style="color:#0f172a;font-weight:900;">${escHtml(
            newP,
          )}</span>`
        : newP
          ? `Now <span style="color:#0f172a;font-weight:900;">${escHtml(newP)}</span>`
          : "";

    const save =
      saveAbs || savePct
        ? `Save <span style="color:rgba(42,120,70,1);font-weight:900;">${escHtml(saveAbs)}${
            savePct ? ` (${escHtml(savePct)})` : ""
          }</span>`
        : "";

    if (!wasNow && !save) return "";

    return `
      ${wasNow ? `<div style="font-size:13px;color:#475569;line-height:1.25;">${wasNow}</div>` : ""}
      ${save ? `<div style="margin-top:4px;font-size:13px;color:#475569;line-height:1.25;">${save}</div>` : ""}
    `.trim();
  }

  // NEW/RETURN/OUT: show current price if present (unrounded)
  const cur = String(ev.priceNow || ev.newPrice || "").trim();
  if (!cur) return "";

  return `<div style="font-size:13px;color:#475569;line-height:1.25;">Price <span style="color:#0f172a;font-weight:900;">${escHtml(
    cur,
  )}</span></div>`;
}

/* ---------- Card ---------- */

function renderEventCard(ev: MatchedEmailEvent): string {
  const url = itemUrl(ev.sku);
  const img = String(ev.skuImg || "").trim();
  const name = ev.skuName || `(SKU ${ev.sku})`;
  const store = String(ev.storeLabel || "").trim();
  const pills = pickBadges(ev);
  const priceHtml = renderPriceHtml(ev);

  return `
<a href="${escHtml(url)}" style="text-decoration:none;color:inherit;display:block;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="border:1px solid #d6dde6;background:#ffffff;border-radius:14px;margin:10px 0;box-shadow:0 1px 2px rgba(15,23,42,0.06);">
    <!-- Title row (full width) -->
    <tr>
      <td style="padding:12px 12px 10px;border-bottom:1px solid #eef2f7;">
        <div style="font-size:15px;font-weight:900;line-height:1.25;margin:0;color:#0f172a;">
          ${escHtml(name)}
        </div>
      </td>
    </tr>

    <!-- Content row -->
    <tr>
      <td style="padding:12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="72" valign="middle" style="width:72px;padding-right:12px;vertical-align:middle;">
              ${
                img
                  ? `<img src="${escHtml(img)}" width="72" height="72" alt="${escHtml(
                      name,
                    )}" style="display:block;width:72px;height:72px;object-fit:cover;border-radius:12px;border:1px solid #e6edf5;background:#f3f6fa;">`
                  : `<div style="width:72px;height:72px;border-radius:12px;border:1px solid #e6edf5;background:#f3f6fa;"></div>`
              }
            </td>

            <td valign="top" style="padding:0;">
              ${
                store
                  ? `<div style="font-size:13px;color:#475569;line-height:1.25;font-weight:700;margin:0 0 6px;">${escHtml(
                      store,
                    )}</div>`
                  : ""
              }
              ${priceHtml ? `<div style="margin:0 0 10px;">${priceHtml}</div>` : `<div style="margin:0 0 10px;"></div>`}

              <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${pills.join("")}
              </div>
            </td>

          </tr>
        </table>
      </td>
    </tr>
  </table>
</a>
  `.trim();
}

/* ---------- Main builder ---------- */

export function buildEmailAlert(
  job: EmailAlertJob,
  meta?: { commitSha?: string },
): { subject: string; text: string; html: string } {
  const total = Array.isArray(job.events) ? job.events.length : 0;
  const s = total === 1 ? "" : "s";
  const subject = `Spirit Tracker: ${total} update${s}`;

  const order: EmailEventType[] = ["PRICE_DROP", "GLOBAL_NEW", "GLOBAL_RETURN", "OUT_OF_STOCK"];
  const groups = new Map<EmailEventType, MatchedEmailEvent[]>();
  for (const t of order) groups.set(t, []);
  for (const ev of job.events || []) {
    const t = ev?.eventType as EmailEventType;
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t)!.push(ev);
  }

  const shaFull = String(meta?.commitSha || "").trim();
  const shaShort = shaFull ? shaFull.slice(0, 12) : "unknown";
  const reportHref = shaFull ? commitUrl(shaFull) : REPO;

  const blurb = buildSummaryParagraph(job.events || [], total);

  // text (keep it useful but not spammy)
  const lines: string[] = [];
  lines.push(`Spirit Tracker`);
  lines.push(`${total} update${s}`);
  lines.push("");
  lines.push(blurb.text);
  lines.push("");

  for (const t of order) {
    const arr = groups.get(t) || [];
    if (!arr.length) continue;
    lines.push(`${groupTitle(t)} (${arr.length})`);
    for (const ev of arr) {
      const url = itemUrl(ev.sku);
      const name = ev.skuName || `(SKU ${ev.sku})`;

      if (ev.eventType === "PRICE_DROP") {
        const oldP = String(ev.oldPrice || "").trim();
        const newP = String(ev.newPrice || "").trim();
        const saveAbs = fmtSaveAbsWhole(ev.dropAbs);
        const savePct = fmtPctWhole(ev.dropPct);
        const best = ev.isCheapestNow ? " [Best price]" : "";
        const line1 = `${oldP ? `Was ${oldP} → ` : ""}${newP ? `Now ${newP}` : "Price updated"}`;
        const line2 = saveAbs || savePct ? `Save ${saveAbs}${saveAbs && savePct ? " " : ""}${savePct ? `(${savePct})` : ""}` : "";
        lines.push(`- ${name}${best}: ${line1}${line2 ? ` | ${line2}` : ""} — ${url}`);
      } else {
        const eb = eventBadge(ev).label;
        const cb = computedBadge(ev);
        const cur = String(ev.priceNow || ev.newPrice || "").trim();
        const extra = [cb ? cb.label : "", cur ? `Price ${cur}` : ""].filter(Boolean).join(", ");
        lines.push(`- ${name}: ${eb}${extra ? ` (${extra})` : ""} — ${url}`);
      }
    }
    lines.push("");
  }

  lines.push(`Commit: ${shaShort}`);
  lines.push(`View full report: ${reportHref}`);

  const sections = order
    .map((t) => {
      const arr = groups.get(t) || [];
      if (!arr.length) return "";
      return `
<div style="margin-top:14px;">
  <div style="font-size:14px;font-weight:900;color:#0f172a;margin:0 0 6px;">
    ${escHtml(groupTitle(t))} <span style="color:#64748b;font-weight:800;">(${arr.length})</span>
  </div>
  ${arr.map(renderEventCard).join("")}
</div>
      `.trim();
    })
    .join("");

  // footer: commit + button on one line (horizontal commit)
  const footerHtml = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="margin-top:18px;border:1px solid #d6dde6;background:#ffffff;border-radius:14px;box-shadow:0 1px 2px rgba(15,23,42,0.06);">
  <tr>
    <td style="padding:14px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td valign="middle" style="padding-right:10px;white-space:nowrap;">
            <span style="font-size:13px;color:#0f172a;font-weight:800;">
              Commit:
              <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:900;">${escHtml(
                shaShort,
              )}</span>
            </span>
          </td>
          <td valign="middle" align="right" style="white-space:nowrap;">
            <a href="${escHtml(reportHref)}"
               style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:12px;padding:10px 14px;font-size:13px;font-weight:900;">
              View full report
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
  `.trim();

  const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f6f9;color:#0f172a;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f6f9" style="background:#f4f6f9;margin:0;padding:0;">
      <tr>
        <td align="center" style="padding:18px 10px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;">
            <tr>
              <td>
                ${blurb.html}
                ${sections}
                ${footerHtml}
                <div style="margin-top:16px;color:#94a3b8;font-size:11px;line-height:1.5;">
                  You’re receiving this because email notifications are enabled.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();

  return { subject, text: lines.join("\n"), html };
}