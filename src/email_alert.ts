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
};

export type EmailAlertJob = {
  userId: string;
  to: string;
  shortlistName: string; // ignored in rendering
  eventCount: number; // ignored; derived from events
  events: MatchedEmailEvent[];
};

const SITE = "https://spirit.codexwilkes.com";
const REPO = "https://github.com/brennanwilkes/spirit-tracker";

function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseMoney(s: string | undefined): number | undefined {
  const raw = String(s ?? "").trim();
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function fmtMoneyWhole(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  return `$${Math.round(n)}`;
}

function fmtMoneyStrWhole(s: string | undefined): string {
  const n = parseMoney(s);
  return fmtMoneyWhole(n);
}

function fmtPctWhole(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  return `${Math.round(Math.abs(n))}%`;
}

function itemUrl(sku: string): string {
  return `${SITE}/#/item/${encodeURIComponent(String(sku || "").trim())}`;
}

function commitUrl(sha: string): string {
  return `${REPO}/commit/${encodeURIComponent(sha)}`;
}

function badge(text: string, tone: "good" | "bad" | "neutral" | "best" | "accent" = "neutral"): string {
  const base =
    "display:inline-block;font-size:11px;line-height:1;padding:6px 9px;border-radius:999px;border:1px solid #242c35;background:#0f1318;color:#9aa6b2;margin:0 6px 0 0;white-space:nowrap;";
  const t =
    tone === "good"
      ? "color:rgba(90,200,120,0.98);border-color:rgba(90,200,120,0.35);background:rgba(90,200,120,0.10);"
      : tone === "bad"
        ? "color:rgba(200,80,80,0.98);border-color:rgba(200,80,80,0.35);background:rgba(200,80,80,0.12);"
        : tone === "best"
          ? "color:rgba(210,170,60,0.98);border-color:rgba(210,170,60,0.26);background:rgba(210,170,60,0.12);"
          : tone === "accent"
            ? "color:#e7edf3;border-color:rgba(125,211,252,0.35);background:rgba(125,211,252,0.08);"
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

function groupTitle(t: EmailEventType): string {
  if (t === "PRICE_DROP") return "On sale";
  if (t === "GLOBAL_NEW") return "Just landed";
  if (t === "GLOBAL_RETURN") return "Back in stock";
  if (t === "OUT_OF_STOCK") return "Out of stock";
  return String(t);
}

function pickBadges(ev: MatchedEmailEvent): string[] {
  const out: string[] = [];

  const eb = eventBadge(ev);
  out.push(badge(eb.label, eb.tone));

  // prioritize "best" then "market-wide" as a second pill
  if (ev.isCheapestNow) out.push(badge("BEST PRICE", "best"));
  else if (ev.marketNew || ev.marketReturn || ev.marketOut) out.push(badge("MARKET-WIDE", "neutral"));

  // hard cap to avoid wrapping on phones
  return out.slice(0, 2);
}

function renderEventCard(ev: MatchedEmailEvent): string {
  const url = itemUrl(ev.sku);
  const img = String(ev.skuImg || "").trim();
  const name = ev.skuName || `(SKU ${ev.sku})`;

  const pills = pickBadges(ev);

  const storeLine = ev.storeLabel
    ? `<div style="margin-top:6px;font-size:12px;color:#9aa6b2;">${escHtml(ev.storeLabel)}</div>`
    : "";

  let priceLine = "";
  if (ev.eventType === "PRICE_DROP") {
    const oldP = fmtMoneyStrWhole(ev.oldPrice);
    const newP = fmtMoneyStrWhole(ev.newPrice);
    const abs = fmtMoneyWhole(ev.dropAbs);
    const pct = fmtPctWhole(ev.dropPct);

    const wasNow =
      oldP && newP
        ? `Was <span style="color:#9aa6b2;">${escHtml(oldP)}</span> → Now <span style="color:#e7edf3;font-weight:900;">${escHtml(newP)}</span>`
        : newP
          ? `Now <span style="color:#e7edf3;font-weight:900;">${escHtml(newP)}</span>`
          : "";

    const save =
      abs || pct
        ? ` · Save <span style="color:rgba(90,200,120,0.98);font-weight:900;">${escHtml(abs)}${
            pct ? ` (${escHtml(pct)})` : ""
          }</span>`
        : "";

    priceLine = wasNow
      ? `<div style="margin-top:6px;font-size:13px;color:#9aa6b2;line-height:1.35;">${wasNow}${save}</div>`
      : "";
  }

  // Whole card is clickable; table keeps left image / right text on mobile.
  return `
<a href="${escHtml(url)}" style="text-decoration:none;color:inherit;display:block;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #242c35;background:#0f1318;border-radius:14px;margin:10px 0;">
    <tr>
      <td style="padding:12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="72" valign="top" style="width:72px;padding-right:12px;">
              ${
                img
                  ? `<img src="${escHtml(img)}" width="72" height="72" alt="${escHtml(
                      name,
                    )}" style="display:block;width:72px;height:72px;object-fit:cover;border-radius:14px;border:1px solid #242c35;background:#0b0d10;">`
                  : `<div style="width:72px;height:72px;border-radius:14px;border:1px solid #242c35;background:#0b0d10;"></div>`
              }
            </td>
            <td valign="top" style="padding:0;">
              <div style="font-size:15px;font-weight:900;line-height:1.25;margin:0;color:#e7edf3;">
                ${escHtml(name)}
              </div>
              ${priceLine}
              ${storeLine}
              <div style="margin-top:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
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

export function buildEmailAlert(
  job: EmailAlertJob,
  meta?: { commitSha?: string },
): { subject: string; text: string; html: string } {
  const total = Array.isArray(job.events) ? job.events.length : 0;
  const s = total === 1 ? "" : "s";
  const subject = `Spirit Tracker: ${total} update${s}`;

  // group events
  const order: EmailEventType[] = ["PRICE_DROP", "GLOBAL_NEW", "GLOBAL_RETURN", "OUT_OF_STOCK"];
  const groups = new Map<EmailEventType, MatchedEmailEvent[]>();
  for (const t of order) groups.set(t, []);
  for (const ev of job.events || []) {
    const t = ev?.eventType as EmailEventType;
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t)!.push(ev);
  }

  // text (minimal)
  const lines: string[] = [];
  lines.push(`Spirit Tracker`);
  lines.push(`${total} update${s}`);
  lines.push("");

  for (const t of order) {
    const arr = groups.get(t) || [];
    if (!arr.length) continue;
    lines.push(`${groupTitle(t)} (${arr.length})`);
    for (const ev of arr) {
      const url = itemUrl(ev.sku);
      const name = ev.skuName || `(SKU ${ev.sku})`;

      if (ev.eventType === "PRICE_DROP") {
        const oldP = fmtMoneyStrWhole(ev.oldPrice);
        const newP = fmtMoneyStrWhole(ev.newPrice);
        const abs = fmtMoneyWhole(ev.dropAbs);
        const pct = fmtPctWhole(ev.dropPct);
        const best = ev.isCheapestNow ? " [Best price]" : "";
        const wasNow = oldP || newP ? ` (Was ${oldP || "?"} → Now ${newP || "?"})` : "";
        const save = abs || pct ? ` (Save ${abs}${abs && pct ? ", " : ""}${pct})` : "";
        lines.push(`- ${name}${best}${wasNow}${save} — ${url}`);
      } else {
        const eb = eventBadge(ev).label;
        const mw = ev.marketNew || ev.marketReturn || ev.marketOut ? " [Market-wide]" : "";
        lines.push(`- ${name}: ${eb}${mw} — ${url}`);
      }
    }
    lines.push("");
  }

  const sha = String(meta?.commitSha || "").trim();
  const reportHref = sha ? commitUrl(sha) : SITE;

  lines.push(`View full report: ${reportHref}`);

  // html
  const headerHtml = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #242c35;background:#12161b;border-radius:14px;">
  <tr>
    <td style="padding:14px 14px 12px;">
      <div style="font-size:16px;font-weight:900;color:#e7edf3;line-height:1.2;">Spirit Tracker</div>
      <div style="margin-top:6px;font-size:13px;color:#9aa6b2;">
        <span style="color:#e7edf3;font-weight:900;">${escHtml(total)}</span> update${escHtml(s)}
      </div>
    </td>
  </tr>
</table>
  `.trim();

  const sections = order
    .map((t) => {
      const arr = groups.get(t) || [];
      if (!arr.length) return "";
      return `
<div style="margin-top:16px;">
  <div style="font-size:14px;font-weight:900;color:#e7edf3;margin:0 0 8px;">
    ${escHtml(groupTitle(t))} <span style="color:#9aa6b2;font-weight:800;">(${arr.length})</span>
  </div>
  ${arr.map(renderEventCard).join("")}
</div>
      `.trim();
    })
    .join("");

  const footerHtml = `
<div style="margin-top:18px;border-top:1px solid #242c35;padding-top:14px;color:#9aa6b2;font-size:12px;line-height:1.6;">
  <a href="${escHtml(reportHref)}" style="color:#7dd3fc;text-decoration:none;font-weight:900;">View full report</a>
</div>
  `.trim();

  // Full-width wrapper fixes the “white margins” effect in many clients.
  const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#0b0d10;color:#e7edf3;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#0b0d10" style="background:#0b0d10;margin:0;padding:0;">
      <tr>
        <td align="center" style="padding:16px 10px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;">
            <tr>
              <td>
                ${headerHtml}
                ${sections}
                ${footerHtml}
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