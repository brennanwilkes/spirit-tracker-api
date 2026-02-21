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


export type Score = Record<string, number>;

export type EmailEventType =
  | "IN_STOCK"
  | "OUT_OF_STOCK"
  | "PRICE_DROP"
  | "GLOBAL_NEW"
  | "GLOBAL_RETURN";

export type EmailRuleV1 = {
  id: string; // uuid
  enabled: boolean;
  scope: "all" | "shortlist";
  eventType: EmailEventType;
  filters?: {
    keywordsAny?: string[];
    keywordsNone?: string[];
    // PRICE_DROP only
    minDropAbs?: number;        // dollars
    minDropPct?: number;        // 0..100
    requireCheapestNow?: boolean;
  };
};

export type EmailNotificationsV1 = {
  version: 1;
  rules: EmailRuleV1[];
};

export type Details = {
  public: boolean;
  shortlistName?: string;
  emailNotifications?: EmailNotificationsV1;
  [k: string]: unknown;
};