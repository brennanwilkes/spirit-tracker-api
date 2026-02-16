export interface Env {
  AUTH_KV: KVNamespace;
  JWT_SECRET: string;
  JWT_ISS: string;
  JWT_AUD: string;
  PASSWORD_PEPPER: string;

  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GH_CLIENT_SECRET: string;

  // SMTP creds + config
  MAIL_HOST: string;          // e.g. "smtp.mailgun.org" or "smtp.gmail.com"
  MAIL_PORT: string;          // e.g. "587" (STARTTLS) or "465" (TLS)
  MAIL_USERNAME: string;  //set by GH actions
  MAIL_PASSWORD: string;  //set by GH actions
}

export type EmailIndex = {
  userId: string;
  pwHash?: string; // optional for OAuth-only accounts
  createdAt: string;

  verified?: boolean;
  verifiedAt?: string;
};

export type Details = {
  public: boolean;
  [k: string]: unknown;
};

export type Score = Record<string, number>;
