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

  // Optional: if you later add this for NEW/RETURN/OUT events
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

function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function itemUrl(sku: string): string {
  return `https://spirit.codexwilkes.com/#/item/${encodeURIComponent(String(sku || "").trim())}`;
}

function commitUrl(sha: string): string {
  return `${REPO}/commit/${encodeURIComponent(sha)}`;
}

function roundDollarFromMoneyStr(s: string | undefined): string {
  const raw = String(s ?? "").trim();
  if (!raw) return "";
  const cleaned = raw.replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return "";
  return `$${Math.round(n)}`;
}

function fmtPctWhole(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  return `${Math.round(Math.abs(n))}%`;
}

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

  if (ev.isCheapestNow) out.push(badge("BEST PRICE", "best"));
  else if (ev.marketNew || ev.marketReturn || ev.marketOut) out.push(badge("MARKET-WIDE", "neutral"));

  return out.slice(0, 2);
}

function priceLine(ev: MatchedEmailEvent): string {
  // Price drop: unrounded prices, rounded discount amounts
  if (ev.eventType === "PRICE_DROP") {
    const oldP = String(ev.oldPrice || "").trim();
    const newP = String(ev.newPrice || "").trim();

    const absRounded = typeof ev.dropAbs === "number" && Number.isFinite(ev.dropAbs) ? `$${Math.round(ev.dropAbs)}` : "";
    const pctRounded = fmtPctWhole(ev.dropPct);

    const wasNow =
      oldP && newP
        ? `Was <span style="color:#66758a;">${escHtml(oldP)}</span> → Now <span style="color:#0f172a;font-weight:900;">${escHtml(
            newP,
          )}</span>`
        : newP
          ? `Now <span style="color:#0f172a;font-weight:900;">${escHtml(newP)}</span>`
          : "";

    const save =
      absRounded || pctRounded
        ? ` · Save <span style="color:rgba(20,120,60,1);font-weight:900;">${escHtml(absRounded)}${
            pctRounded ? ` (${escHtml(pctRounded)})` : ""
          }</span>`
        : "";

    return wasNow ? `${wasNow}${save}` : "";
  }

  // For NEW/RETURN/OUT: show current price if available
  const cur = String(ev.priceNow || ev.newPrice || "").trim();
  if (cur) return `Price <span style="color:#0f172a;font-weight:900;">${escHtml(cur)}</span>`;
  return "";
}

function renderEventCard(ev: MatchedEmailEvent): string {
  const url = itemUrl(ev.sku);
  const img = String(ev.skuImg || "").trim();
  const name = ev.skuName || `(SKU ${ev.sku})`;
  const store = String(ev.storeLabel || "").trim();

  const pills = pickBadges(ev);
  const pLine = priceLine(ev);

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

    <!-- Content row: image left, details right -->
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
              ${
                store
                  ? `<div style="font-size:13px;color:#475569;line-height:1.25;margin:0;">${escHtml(store)}</div>`
                  : ""
              }

              ${
                pLine
                  ? `<div style="margin-top:6px;font-size:13px;color:#475569;line-height:1.35;">${pLine}</div>`
                  : ""
              }

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

  const order: EmailEventType[] = ["PRICE_DROP", "GLOBAL_NEW", "GLOBAL_RETURN", "OUT_OF_STOCK"];
  const groups = new Map<EmailEventType, MatchedEmailEvent[]>();
  for (const t of order) groups.set(t, []);
  for (const ev of job.events || []) {
    const t = ev?.eventType as EmailEventType;
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t)!.push(ev);
  }

  // text
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
        const oldP = String(ev.oldPrice || "").trim();
        const newP = String(ev.newPrice || "").trim();

        const absRounded = typeof ev.dropAbs === "number" && Number.isFinite(ev.dropAbs) ? roundDollarFromMoneyStr(String(ev.dropAbs)) : "";
        const pctRounded = fmtPctWhole(ev.dropPct);

        const save = absRounded || pctRounded ? ` (Save ${absRounded}${absRounded && pctRounded ? ", " : ""}${pctRounded})` : "";
        const best = ev.isCheapestNow ? " [Best price]" : "";
        lines.push(`- ${name}${best}: ${oldP ? `Was ${oldP} → ` : ""}${newP ? `Now ${newP}` : ""}${save} — ${url}`);
      } else {
        const eb = eventBadge(ev).label;
        const cur = String(ev.priceNow || ev.newPrice || "").trim();
        const priceTxt = cur ? ` (Price ${cur})` : "";
        const mw = ev.marketNew || ev.marketReturn || ev.marketOut ? " [Market-wide]" : "";
        lines.push(`- ${name}: ${eb}${mw}${priceTxt} — ${url}`);
      }
    }
    lines.push("");
  }

  const sha = String(meta?.commitSha || "").trim();
  const reportHref = sha ? commitUrl(sha) : REPO;

  lines.push(`View full report: ${reportHref}`);

  // optional blurb if many updates
  const blurbHtml =
    total > 10
      ? `
<div style="margin:12px 0 2px;font-size:13px;color:#475569;line-height:1.5;">
  Here’s what changed since the last run — grouped by type. Tap any bottle to open it.
</div>
        `.trim()
      : "";

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

  const reportBlock = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="margin-top:18px;border:1px solid #d6dde6;background:#ffffff;border-radius:14px;box-shadow:0 1px 2px rgba(15,23,42,0.06);">
  <tr>
    <td style="padding:14px;">
      <div style="font-size:13px;color:#475569;margin:0 0 8px;">Want the full diff / run details?</div>
      <a href="${escHtml(reportHref)}"
         style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:12px;padding:10px 14px;font-size:13px;font-weight:900;">
        View full report
      </a>
      ${
        sha
          ? `<div style="margin-top:8px;font-size:12px;color:#64748b;">Commit: <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escHtml(
              sha.slice(0, 7),
            )}</span></div>`
          : ""
      }
    </td>
  </tr>
</table>
  `.trim();

  // Light page background so it blends with iOS Mail
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
                ${blurbHtml}
                ${sections}
                ${reportBlock}
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