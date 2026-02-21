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
  if (ev.marketOut) return { label: "MARKET OUT", tone: "neutral" };
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

/* ---------- Summary blurb (own method) ---------- */

function getBrandHeuristic(name: string): string {
  const s = String(name || "").trim();
  if (!s) return "";
  const words = s
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  const stopWords = new Set([
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
    "y/o",
  ]);

  const out: string[] = [];
  for (const w of words) {
    const lw = w.toLowerCase();
    if (/\d/.test(w)) break;
    if (stopWords.has(lw) && out.length >= 1) break;
    out.push(w);
    if (out.length >= 3) break;
  }
  // common two-word brands should still work (Old Forester, Co-op, etc.)
  return out.join(" ").trim();
}

function buildSummaryBlurb(
  events: MatchedEmailEvent[],
  total: number,
): { html: string; text: string } {
  const counts: Record<string, number> = { PRICE_DROP: 0, GLOBAL_NEW: 0, GLOBAL_RETURN: 0, OUT_OF_STOCK: 0 };
  const byStoreNew = new Map<string, number>();
  const byStoreReturn = new Map<string, number>();
  const byBrand = new Map<string, number>();

  let bestDeal: MatchedEmailEvent | null = null;
  let bestDealScore = -1;

  for (const ev of events || []) {
    counts[String(ev.eventType)] = (counts[String(ev.eventType)] || 0) + 1;

    // store signals
    const store = String(ev.storeLabel || "").trim();
    if (store) {
      if (ev.eventType === "GLOBAL_NEW") byStoreNew.set(store, (byStoreNew.get(store) || 0) + 1);
      if (ev.eventType === "GLOBAL_RETURN") byStoreReturn.set(store, (byStoreReturn.get(store) || 0) + 1);
    }

    // brand signals
    const brand = getBrandHeuristic(String(ev.skuName || ""));
    if (brand) byBrand.set(brand, (byBrand.get(brand) || 0) + 1);

    // best deal heuristic
    if (ev.eventType === "PRICE_DROP") {
      const abs = typeof ev.dropAbs === "number" && Number.isFinite(ev.dropAbs) ? ev.dropAbs : 0;
      const pct = typeof ev.dropPct === "number" && Number.isFinite(ev.dropPct) ? ev.dropPct : 0;
      const score = abs * 2 + pct; // weight dollars a bit more
      if (score > bestDealScore) {
        bestDealScore = score;
        bestDeal = ev;
      }
    }
  }

  const introShort =
    `Tap any bottle to open it. Scroll to the bottom for the full report.`;
  const introLong =
    `Lots of movement today. Tap any bottle to open it. Scroll to the bottom for the full report.`;

  const typeLine =
    `${total} update${total === 1 ? "" : "s"} · ` +
    `${counts.PRICE_DROP || 0} sale${(counts.PRICE_DROP || 0) === 1 ? "" : "s"}, ` +
    `${counts.GLOBAL_NEW || 0} just landed, ` +
    `${counts.GLOBAL_RETURN || 0} back, ` +
    `${counts.OUT_OF_STOCK || 0} out`;

  function topN(map: Map<string, number>, n: number): Array<{ k: string; v: number }> {
    return Array.from(map.entries())
      .map(([k, v]) => ({ k, v }))
      .sort((a, b) => b.v - a.v || a.k.localeCompare(b.k))
      .slice(0, n);
  }

  const topNewStores = topN(byStoreNew, 3);
  const topReturnStores = topN(byStoreReturn, 3);
  const topBrands = topN(byBrand, 4);

  const dealLine = bestDeal
    ? (() => {
        const name = bestDeal.skuName || `(SKU ${bestDeal.sku})`;
        const store = String(bestDeal.storeLabel || "").trim();
        const saveAbs = fmtSaveAbsWhole(bestDeal.dropAbs);
        const savePct = fmtPctWhole(bestDeal.dropPct);
        const best = bestDeal.isCheapestNow ? " (best price)" : "";
        const save = [saveAbs, savePct ? `(${savePct})` : ""].filter(Boolean).join(" ");
        return `Best deal: ${name} — save ${save || "?"}${store ? ` at ${store}` : ""}${best}.`;
      })()
    : "";

  const newStoresLine =
    topNewStores.length
      ? `Just landed: ${topNewStores.map((x) => `${x.k} (${x.v})`).join(", ")}.`
      : "";

  const returnStoresLine =
    topReturnStores.length
      ? `Back in stock: ${topReturnStores.map((x) => `${x.k} (${x.v})`).join(", ")}.`
      : "";

  const brandsLine =
    topBrands.length
      ? `Trending: ${topBrands.map((x) => x.k).join(", ")}.`
      : "";

  const longTextParts = [
    typeLine + ".",
    dealLine,
    newStoresLine,
    returnStoresLine,
    brandsLine,
    introLong,
  ].filter(Boolean);

  const shortTextParts = [
    typeLine + ".",
    introShort,
  ].filter(Boolean);

  const longHtml = `
<div style="margin:0 0 12px;font-size:13px;color:#475569;line-height:1.6;">
  <div style="font-weight:800;color:#0f172a;margin-bottom:4px;">${escHtml(typeLine)}</div>
  ${dealLine ? `<div style="margin-top:6px;">${escHtml(dealLine)}</div>` : ""}
  ${newStoresLine ? `<div style="margin-top:6px;">${escHtml(newStoresLine)}</div>` : ""}
  ${returnStoresLine ? `<div style="margin-top:6px;">${escHtml(returnStoresLine)}</div>` : ""}
  ${brandsLine ? `<div style="margin-top:6px;">${escHtml(brandsLine)}</div>` : ""}
  <div style="margin-top:10px;">Tap any bottle to open it. Scroll to the bottom for the full report.</div>
</div>
  `.trim();

  const shortHtml = `
<div style="margin:0 0 12px;font-size:13px;color:#475569;line-height:1.6;">
  <div style="font-weight:800;color:#0f172a;margin-bottom:6px;">${escHtml(typeLine)}</div>
  <div>Tap any bottle to open it. Scroll to the bottom for the full report.</div>
</div>
  `.trim();

  if (total > 10) {
    return { html: longHtml, text: longTextParts.join("\n") };
  }
  return { html: shortHtml, text: shortTextParts.join("\n") };
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
            <td width="72" valign="top" style="width:72px;padding-right:12px;">
              ${
                img
                  ? `<img src="${escHtml(img)}" width="72" height="72" alt="${escHtml(
                      name,
                    )}" style="display:block;width:72px;height:72px;object-fit:cover;border-radius:12px;border:1px solid #e6edf5;background:#f3f6fa;">`
                  : `<div style="width:72px;height:72px;border-radius:12px;border:1px solid #e6edf5;background:#f3f6fa;"></div>`
              }
            </td>

            <td valign="top" style="padding:0;">
              <!-- more even: top stack + badges anchored near bottom, but without big "space-between" gaps -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="height:72px;">
                <tr>
                  <td valign="top" style="padding:0;">
                    ${store ? `<div style="font-size:13px;color:#475569;line-height:1.25;">${escHtml(store)}</div>` : ""}
                    ${priceHtml ? `<div style="margin-top:6px;">${priceHtml}</div>` : ""}
                  </td>
                </tr>
                <tr>
                  <td valign="bottom" style="padding:0;">
                    <div style="margin-top:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                      ${pills.join("")}
                    </div>
                  </td>
                </tr>
              </table>
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

  const blurb = buildSummaryBlurb(job.events || [], total);

  // text (minimal-ish but useful)
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
            <a href="${escHtml(reportHref)}" style="color:#0f172a;text-decoration:none;font-size:13px;font-weight:900;">
              Commit: <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escHtml(shaShort)}</span>
            </a>
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