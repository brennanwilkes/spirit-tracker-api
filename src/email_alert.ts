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
  shortlistName: string;
  eventCount: number;
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
  // keep digits, dot, minus
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
    "display:inline-block;font-size:12px;line-height:1.2;padding:7px 10px;border-radius:999px;border:1px solid #242c35;background:#0f1318;color:#9aa6b2;margin:0 6px 6px 0;white-space:nowrap;";
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

function renderEventCard(ev: MatchedEmailEvent): string {
  const url = itemUrl(ev.sku);
  const img = String(ev.skuImg || "").trim();
  const name = ev.skuName || `(SKU ${ev.sku})`;

  const badges: string[] = [];
  const eb = eventBadge(ev);
  badges.push(badge(eb.label, eb.tone));

  // Market-wide signals (computed flags)
  if (ev.marketNew || ev.marketReturn || ev.marketOut) badges.push(badge("MARKET-WIDE", "neutral"));

  if (ev.storeLabel) badges.push(badge(ev.storeLabel, "neutral"));
  if (ev.isCheapestNow) badges.push(badge("BEST PRICE", "best"));

  // Minimal price line (rounded)
  let priceLine = "";
  if (ev.eventType === "PRICE_DROP") {
    const oldP = fmtMoneyStrWhole(ev.oldPrice);
    const newP = fmtMoneyStrWhole(ev.newPrice);
    const abs = fmtMoneyWhole(ev.dropAbs);
    const pct = fmtPctWhole(ev.dropPct);

    const left = oldP ? `Was ${escHtml(oldP)}` : "";
    const mid = newP ? `Now <span style="color:#e7edf3;font-weight:800;">${escHtml(newP)}</span>` : "";
    const save = abs || pct ? `Save <span style="color:rgba(90,200,120,0.98);font-weight:800;">${escHtml(abs)}${abs && pct ? " · " : ""}${escHtml(pct)}</span>` : "";

    const parts = [left, mid].filter(Boolean).join(" • ");
    priceLine = [parts, save].filter(Boolean).join(" &nbsp; ");
  }

  // Mobile-first: always stacked, full width, large tap target.
  return `
<a href="${escHtml(url)}" style="text-decoration:none;color:inherit;display:block;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #242c35;background:#0f1318;border-radius:16px;margin:12px 0;">
    <tr>
      <td style="padding:14px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding:2px 0 10px;">
              ${
                img
                  ? `<img src="${escHtml(img)}" width="96" height="96" alt="${escHtml(
                      name,
                    )}" style="display:block;width:96px;height:96px;object-fit:cover;border-radius:16px;border:1px solid #242c35;background:#0b0d10;">`
                  : `<div style="width:96px;height:96px;border-radius:16px;border:1px solid #242c35;background:#0b0d10;"></div>`
              }
            </td>
          </tr>
          <tr>
            <td style="padding:0 2px;">
              <div style="font-size:16px;font-weight:900;line-height:1.25;margin:0;color:#e7edf3;">
                ${escHtml(name)}
              </div>
              ${
                priceLine
                  ? `<div style="margin-top:8px;font-size:14px;color:#9aa6b2;line-height:1.35;">${priceLine}</div>`
                  : ""
              }
              <div style="margin-top:10px;">${badges.join("")}</div>
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

  if (meta?.commitSha) {
    const sha = String(meta.commitSha).trim();
    if (sha) lines.push(`Build: ${commitUrl(sha)}`);
  }

  lines.push(`Open: ${SITE}`);

  // html
  const sections = order
    .map((t) => {
      const arr = groups.get(t) || [];
      if (!arr.length) return "";
      return `
        <div style="margin-top:18px;">
          <div style="font-size:14px;font-weight:900;color:#e7edf3;margin:0 0 8px;">
            ${escHtml(groupTitle(t))} <span style="color:#9aa6b2;font-weight:700;">(${arr.length})</span>
          </div>
          ${arr.map(renderEventCard).join("")}
        </div>
      `;
    })
    .join("");

  const sha = String(meta?.commitSha || "").trim();
  const shaShort = sha ? sha.slice(0, 7) : "";
  const shaHref = sha ? commitUrl(sha) : "";

  // Full-width bg wrapper table fixes “white margins” in many clients.
  const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#0b0d10;color:#e7edf3;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#0b0d10" style="background:#0b0d10;">
      <tr>
        <td align="center" style="padding:18px 10px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;">
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #242c35;background:#12161b;border-radius:16px;">
                  <tr>
                    <td style="padding:16px;">
                      <div style="font-size:20px;font-weight:900;margin:0;color:#e7edf3;">Spirit Tracker</div>
                      <div style="margin-top:8px;font-size:14px;color:#9aa6b2;line-height:1.4;">
                        <span style="color:#e7edf3;font-weight:900;">${escHtml(total)}</span> update${escHtml(s)}
                      </div>
                    </td>
                  </tr>
                </table>

                ${sections}

                <div style="margin-top:18px;border-top:1px solid #242c35;padding-top:14px;color:#9aa6b2;font-size:12px;line-height:1.6;">
                  <div>Open: <a href="${escHtml(SITE)}" style="color:#7dd3fc;text-decoration:none;">${escHtml(SITE)}</a></div>
                  ${
                    shaHref
                      ? `<div style="margin-top:6px;">Build: <a href="${escHtml(
                          shaHref,
                        )}" style="color:#7dd3fc;text-decoration:none;">${escHtml(shaShort)}</a></div>`
                      : ""
                  }
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