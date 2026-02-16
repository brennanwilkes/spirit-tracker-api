import { connect } from 'cloudflare:sockets';
import type { Env } from './types';

const FROM_EMAIL = 'spirit@codexwilkes.com';
const FROM_HEADER = 'Spirit Tracker <spirit@codexwilkes.com>';
function log(stage: string, data?: unknown) {
  if (data !== undefined) {
    console.log(`[smtp] ${stage}`, data);
  } else {
    console.log(`[smtp] ${stage}`);
  }
}

type Mail = {
  to: string;
  subject: string;
  text: string;
};

function b64Std(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64StdText(s: string): string {
  return b64Std(new TextEncoder().encode(s));
}

function formatDate(d = new Date()): string {
  // RFC 2822-ish; good enough for transactional mail
  return d.toUTCString();
}

function dotStuff(text: string): string {
  // SMTP DATA dot-stuffing
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => (line.startsWith('.') ? '.' + line : line))
    .join('\r\n');
}

class SmtpClient {
  private socket: any;
  private reader!: ReadableStreamDefaultReader<Uint8Array>;
  private writer!: WritableStreamDefaultWriter<Uint8Array>;
  private bufText = '';
  private dec = new TextDecoder();
  private enc = new TextEncoder();

  constructor(socket: any) {
    this.socket = socket;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  startTls(): SmtpClient {
    const secure = this.socket.startTls();
    return new SmtpClient(secure);
  }

  async close(): Promise<void> {
    try { await this.writer.close(); } catch {}
    try { await this.socket.close(); } catch {}
    try { await this.reader.cancel(); } catch {}
  }

  private async readLine(): Promise<string> {
    while (true) {
      const idx = this.bufText.indexOf('\n');
      if (idx !== -1) {
        const line = this.bufText.slice(0, idx + 1);
        this.bufText = this.bufText.slice(idx + 1);
        return line.replace(/\r?\n$/, '');
      }
      const r = await this.reader.read();
      if (r.done) throw new Error('SMTP connection closed');
      this.bufText += this.dec.decode(r.value, { stream: true });
    }
  }

  async readResponse(): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    let code = 0;

    while (true) {
      const line = await this.readLine();
      lines.push(line);

      const m = line.match(/^(\d{3})([ -])(.*)$/);
      if (!m) continue;

      code = Number(m[1]);
      const sep = m[2];
      if (sep === ' ') break; // final line
    }

    return { code, lines };
  }

  async sendRaw(line: string): Promise<void> {
    await this.writer.write(this.enc.encode(line));
  }

  async sendLine(line: string): Promise<void> {
    await this.sendRaw(line + '\r\n');
  }

  async cmd(line: string): Promise<{ code: number; lines: string[] }> {
    await this.sendLine(line);
    return await this.readResponse();
  }
}

function pickEhloName(): string {
  return 'spirit-tracker';
}

function parseEhloCaps(lines: string[]): Set<string> {
  // EHLO lines look like: "250-PIPELINING", "250-AUTH PLAIN LOGIN", etc
  const caps = new Set<string>();
  for (const l of lines) {
    const m = l.match(/^\d{3}[ -](.+)$/);
    if (!m) continue;
    caps.add(m[1].trim().toUpperCase());
  }
  return caps;
}

function hasAuthPlain(caps: Set<string>): boolean {
  for (const c of caps) if (c.startsWith('AUTH ') && c.includes(' PLAIN')) return true;
  return false;
}

function hasAuthLogin(caps: Set<string>): boolean {
  for (const c of caps) if (c.startsWith('AUTH ') && c.includes(' LOGIN')) return true;
  return false;
}

function hasStartTls(caps: Set<string>): boolean {
  return caps.has('STARTTLS');
}

async function smtpAuth(
  client: SmtpClient,
  caps: Set<string>,
  username: string,
  password: string
): Promise<void> {
  if (hasAuthPlain(caps)) {
    // AUTH PLAIN base64("\0user\0pass")
    const msg = `\u0000${username}\u0000${password}`;
    const r = await client.cmd(`AUTH PLAIN ${b64StdText(msg)}`);
    if (r.code !== 235) throw new Error(`SMTP auth failed (${r.code})`);
    return;
  }

  // AUTH LOGIN, then username, then password
  if (hasAuthLogin(caps)) {
    let r = await client.cmd('AUTH LOGIN');
    if (r.code !== 334) throw new Error(`SMTP auth failed (${r.code})`);
    r = await client.cmd(b64StdText(username));
    if (r.code !== 334) throw new Error(`SMTP auth failed (${r.code})`);
    r = await client.cmd(b64StdText(password));
    if (r.code !== 235) throw new Error(`SMTP auth failed (${r.code})`);
    return;
  }

  throw new Error('SMTP server does not support AUTH PLAIN/LOGIN');
}


export async function sendMailSmtp(env: Env, mail: Mail): Promise<void> {
  const host = String(env.MAIL_HOST || '').trim();
  const port = Number(env.MAIL_PORT || '0');
  const username = String(env.MAIL_USERNAME || '').trim();
  const password = String(env.MAIL_PASSWORD || '').trim();

  log('env-check', {
    MAIL_HOST: host,
    MAIL_PORT: port,
    has_USERNAME: Boolean(username),
    has_PASSWORD: Boolean(password),
    env_keys: Object.keys(env).sort(),
  });

  if (!host) throw new Error('MAIL_HOST not configured');
  if (!Number.isFinite(port) || port <= 0) throw new Error('MAIL_PORT not configured');
  if (!username || !password) throw new Error('MAIL_USERNAME/MAIL_PASSWORD not configured');

  const to = String(mail.to || '').trim();
  if (!to || !to.includes('@')) throw new Error('Invalid recipient');

  const secureTransport = port === 465 ? 'on' : 'starttls';
  const socket = connect({ hostname: host, port }, { secureTransport } as any);
  let client = new SmtpClient(socket);

  let isEncrypted = secureTransport === 'on';

  try {
    let r = await client.readResponse();
    if (r.code !== 220) throw new Error(`SMTP banner failed (${r.code})`);

    r = await client.cmd(`EHLO ${pickEhloName()}`);
    if (r.code !== 250) throw new Error(`SMTP EHLO failed (${r.code})`);
    let caps = parseEhloCaps(r.lines);

    if (!isEncrypted) {
      if (!hasStartTls(caps)) throw new Error('SMTP server does not support STARTTLS');
      r = await client.cmd('STARTTLS');
      if (r.code !== 220) throw new Error(`SMTP STARTTLS failed (${r.code})`);
      client = client.startTls();
      isEncrypted = true;

      r = await client.cmd(`EHLO ${pickEhloName()}`);
      if (r.code !== 250) throw new Error(`SMTP EHLO (post-TLS) failed (${r.code})`);
      caps = parseEhloCaps(r.lines);
    }

    await smtpAuth(client, caps, username, password);

    r = await client.cmd(`MAIL FROM:<${FROM_EMAIL}>`);
    if (r.code !== 250) throw new Error(`SMTP MAIL FROM failed (${r.code})`);
    r = await client.cmd(`RCPT TO:<${to}>`);
    if (r.code !== 250 && r.code !== 251) throw new Error(`SMTP RCPT TO failed (${r.code})`);

    r = await client.cmd('DATA');
    if (r.code !== 354) throw new Error(`SMTP DATA failed (${r.code})`);

    const msgId = `<${crypto.randomUUID()}@${pickEhloName()}>`;
    const bodyText = dotStuff(String(mail.text || ''));

    const data =
      `From: ${FROM_HEADER}\r\n` +
      `To: ${to}\r\n` +
      `Subject: ${String(mail.subject || '').replace(/\r|\n/g, ' ').trim()}\r\n` +
      `Date: ${formatDate()}\r\n` +
      `Message-ID: ${msgId}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `Content-Transfer-Encoding: 8bit\r\n` +
      `\r\n` +
      `${bodyText}\r\n` +
      `\r\n.\r\n`;

    await client.sendRaw(data);
    r = await client.readResponse();
    if (r.code !== 250) throw new Error(`SMTP send failed (${r.code})`);

    try { await client.cmd('QUIT'); } catch {}
  } finally {
    await client.close();
  }
}
