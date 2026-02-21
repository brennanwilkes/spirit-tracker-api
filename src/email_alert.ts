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

function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtMoney(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  // keep one decimal if needed
  const v = Math.abs(n);
  const oneDec = Math.round(v * 10) / 10;
  return `${oneDec % 1 === 0 ? Math.round(oneDec) : oneDec}%`;
}

function itemUrl(sku: string): string {
  return `${SITE}/#/item/${encodeURIComponent(String(sku || "").trim())}`;
}

function shortlistUrl(userId: string): string {
  return `${SITE}/#/shortlist/${encodeURIComponent(String(userId || "").trim())}`;
}

function badge(text: string, tone: "good" | "bad" | "neutral" | "best" | "accent" = "neutral"): string {
  const base =
    "display:inline-block;font-size:12px;line-height:1.2;padding:6px 10px;border-radius:999px;border:1px solid #242c35;background:#0f1318;color:#9aa6b2;margin-right:6px;white-space:nowrap;";
  const t =
    tone === "good"
      ? "color:rgba(90,200,120,0.95);border-color:rgba(90,200,120,0.35);background:rgba(90,200,120,0.10);"
      : tone === "bad"
        ? "color:rgba(200,80,80,0.95);border-color:rgba(200,80,80,0.35);background:rgba(200,80,80,0.12);"
        : tone === "best"
          ? "color:rgba(210,170,60,0.95);border-color:rgba(210,170,60,0.26);background:rgba(210,170,60,0.12);"
          : tone === "accent"
            ? "color:#e7edf3;border-color:rgba(125,211,252,0.35);background:rgba(125,211,252,0.08);"
            : "";
  return `<span style="${base}${t}">${escHtml(text)}</span>`;
}

function eventLabel(ev: MatchedEmailEvent): { label: string; tone: "good" | "bad" | "neutral" | "accent" } {
  switch (ev.eventType) {
    case "PRICE_DROP":
      return { label: "PRICE DROP", tone: "good" };
    case "GLOBAL_NEW":
      return { label: "NEW", tone: "accent" };
    case "GLOBAL_RETURN":
      return { label: "BACK", tone: "accent" };
    case "OUT_OF_STOCK":
      return { label: "OUT OF STOCK", tone: "bad" };
    default:
      return { label: String(ev.eventType), tone: "neutral" };
  }
}

function groupTitle(t: EmailEventType): string {
  if (t === "PRICE_DROP") return "Price drops";
  if (t === "GLOBAL_NEW") return "New arrivals";
  if (t === "GLOBAL_RETURN") return "Back in stock";
  if (t === "OUT_OF_STOCK") return "Out of stock";
  return String(t);
}

function renderEventCard(ev: MatchedEmailEvent): string {
  const url = itemUrl(ev.sku);
  const img = String(ev.skuImg || "").trim();
  const name = ev.skuName || `(SKU ${ev.sku})`;

  const metaBadges: string[] = [];
  const el = eventLabel(ev);
  metaBadges.push(badge(el.label, el.tone));
  if (ev.storeLabel) metaBadges.push(badge(ev.storeLabel, "neutral"));

  if (ev.eventType === "PRICE_DROP") {
    const oldP = String(ev.oldPrice || "").trim();
    const newP = String(ev.newPrice || "").trim();
    const abs = fmtMoney(ev.dropAbs);
    const pct = fmtPct(ev.dropPct);
    if (ev.isCheapestNow) metaBadges.push(badge("BEST PRICE", "best"));

    const dealLine =
      (oldP && newP ? `${escHtml(oldP)} → <span style="color:#e7edf3;font-weight:700;">${escHtml(newP)}</span>` : "") +
      (abs || pct ? ` &nbsp; <span style="color:rgba(90,200,120,0.95);font-weight:700;">Save ${escHtml(abs || "")}${abs && pct ? " · " : ""}${escHtml(pct || "")}</span>` : "");

    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #242c35;background:#0f1318;border-radius:12px;margin:10px 0;">
        <tr>
          <td style="padding:12px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="72" valign="top" style="width:72px;">
                  <a href="${escHtml(url)}" style="text-decoration:none;">
                    ${
                      img
                        ? `<img src="${escHtml(img)}" width="72" height="72" alt="${escHtml(
                            name,
                          )}" style="display:block;width:72px;height:72px;object-fit:cover;border-radius:12px;border:1px solid #242c35;background:#0b0d10;">`
                        : `<div style="width:72px;height:72px;border-radius:12px;border:1px solid #242c35;background:#0b0d10;"></div>`
                    }
                  </a>
                </td>
                <td valign="top" style="padding-left:12px;">
                  <div style="font-size:14px;font-weight:700;line-height:1.3;margin:0;">
                    <a href="${escHtml(url)}" style="color:#7dd3fc;text-decoration:none;">${escHtml(name)}</a>
                  </div>
                  <div style="margin-top:6px;font-size:13px;color:#9aa6b2;line-height:1.45;">
                    ${dealLine || `<span style="color:#9aa6b2;">Price updated</span>`}
                  </div>
                  <div style="margin-top:10px;">
                    ${metaBadges.join("")}
                    ${badge("View item", "accent")}
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    `;
  }

  // Non-price-drop
  let line = "";
  if (ev.eventType === "GLOBAL_NEW") line = "Just landed — tap to see details and current availability.";
  else if (ev.eventType === "GLOBAL_RETURN") line = "Back in stock — tap to see current availability.";
  else if (ev.eventType === "OUT_OF_STOCK") line = ev.marketOut ? "Currently out across the market." : "Currently out at a tracked store.";
  else line = "Update available.";

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #242c35;background:#0f1318;border-radius:12px;margin:10px 0;">
      <tr>
        <td style="padding:12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="72" valign="top" style="width:72px;">
                <a href="${escHtml(url)}" style="text-decoration:none;">
                  ${
                    img
                      ? `<img src="${escHtml(img)}" width="72" height="72" alt="${escHtml(
                          name,
                        )}" style="display:block;width:72px;height:72px;object-fit:cover;border-radius:12px;border:1px solid #242c35;background:#0b0d10;">`
                      : `<div style="width:72px;height:72px;border-radius:12px;border:1px solid #242c35;background:#0b0d10;"></div>`
                  }
                </a>
              </td>
              <td valign="top" style="padding-left:12px;">
                <div style="font-size:14px;font-weight:700;line-height:1.3;margin:0;">
                  <a href="${escHtml(url)}" style="color:#7dd3fc;text-decoration:none;">${escHtml(name)}</a>
                </div>
                <div style="margin-top:6px;font-size:13px;color:#9aa6b2;line-height:1.45;">
                  ${escHtml(line)}
                </div>
                <div style="margin-top:10px;">
                  ${metaBadges.join("")}
                  ${badge("View item", "accent")}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

export function buildEmailAlert(job: EmailAlertJob, meta?: { generatedAt?: string }): { subject: string; text: string; html: string } {
  const shortlist = String(job.shortlistName || "").trim();
  const title = shortlist ? `“${shortlist}”` : "your shortlist";

  const total = Array.isArray(job.events) ? job.events.length : 0;
  const s = total === 1 ? "" : "s";
  const subject = `Spirit Tracker: ${total} update${s} for ${shortlist || "your shortlist"}`;

  // group events
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
  if (shortlist) lines.push(`Shortlist: ${shortlist}`);
  if (meta?.generatedAt) lines.push(`Generated: ${meta.generatedAt}`);
  lines.push("");
  lines.push(`View shortlist: ${shortlistUrl(job.userId)}`);
  lines.push("");

  for (const t of order) {
    const arr = groups.get(t) || [];
    if (!arr.length) continue;
    lines.push(`${groupTitle(t)} (${arr.length})`);
    for (const ev of arr) {
      const url = itemUrl(ev.sku);
      const name = ev.skuName || `(SKU ${ev.sku})`;
      if (ev.eventType === "PRICE_DROP") {
        const oldP = ev.oldPrice ? ` ${ev.oldPrice}` : "";
        const newP = ev.newPrice ? ` -> ${ev.newPrice}` : "";
        const abs = fmtMoney(ev.dropAbs);
        const pct = fmtPct(ev.dropPct);
        const save = abs || pct ? ` (Save ${abs}${abs && pct ? ", " : ""}${pct})` : "";
        const best = ev.isCheapestNow ? " [Best price]" : "";
        lines.push(`- ${name}${best}:${oldP}${newP}${save} — ${url}`);
      } else {
        lines.push(`- ${name}: ${t} — ${url}`);
      }
    }
    lines.push("");
  }

  lines.push(`You're receiving this because email notifications are enabled.`);
  lines.push(`Open Spirit Tracker: ${SITE}`);

  // html
  const headerRight = meta?.generatedAt
    ? `<div style="font-size:12px;color:#9aa6b2;">Generated: ${escHtml(meta.generatedAt)}</div>`
    : "";

  const sections = order
    .map((t) => {
      const arr = groups.get(t) || [];
      if (!arr.length) return "";
      return `
        <div style="margin-top:16px;">
          <div style="font-size:13px;font-weight:700;color:#e7edf3;margin:0 0 6px;">
            ${escHtml(groupTitle(t))} <span style="color:#9aa6b2;font-weight:600;">(${arr.length})</span>
          </div>
          ${arr.map(renderEventCard).join("")}
        </div>
      `;
    })
    .join("");

  const ctaUrl = shortlistUrl(job.userId);

  const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#0b0d10;color:#e7edf3;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;">
    <div style="max-width:720px;margin:0 auto;padding:18px;">
      <div style="border:1px solid #242c35;background:#12161b;border-radius:12px;padding:16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td valign="top" style="padding-right:12px;">
              <div style="font-size:18px;font-weight:800;margin:0;color:#e7edf3;">Spirit Tracker</div>
              <div style="margin-top:6px;font-size:13px;color:#9aa6b2;">
                Shortlist: <span style="color:#e7edf3;font-weight:700;">${escHtml(shortlist || "—")}</span>
              </div>
              <div style="margin-top:10px;font-size:13px;color:#9aa6b2;">
                ${escHtml(total)} update${escHtml(s)} • tap any bottle to view details
              </div>
            </td>
            <td valign="top" align="right" style="white-space:nowrap;">
              ${headerRight}
              <div style="margin-top:10px;">
                <a href="${escHtml(ctaUrl)}"
                   style="display:inline-block;background:#0f1318;border:1px solid #242c35;color:#e7edf3;text-decoration:none;border-radius:10px;padding:10px 14px;font-size:13px;font-weight:700;">
                  View shortlist
                </a>
              </div>
            </td>
          </tr>
        </table>
      </div>

      ${sections}

      <div style="margin-top:18px;border-top:1px solid #242c35;padding-top:14px;color:#9aa6b2;font-size:12px;line-height:1.5;">
        <div>Open Spirit Tracker: <a href="${escHtml(SITE)}" style="color:#7dd3fc;text-decoration:none;">${escHtml(SITE)}</a></div>
        <div style="margin-top:6px;">You’re receiving this because email notifications are enabled.</div>
      </div>
    </div>
  </body>
</html>
  `.trim();

  return { subject, text: lines.join("\n"), html };
}