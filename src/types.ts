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
    // NEW
    storeId?: string;          // e.g. "kwm"
    acrossMarket?: boolean;    // apply to all stores (same bottle)

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

export type EmailPackOfferV1 = {
  storeId: string;
  storeLabel: string;
  url: string;
  price: string;
  priceNum: number | null;
};

export type EmailPackSkuV1 = {
  sku: string;
  name: string;
  img: string;
  members: string[];
  priceRangeNow: { min: number; max: number } | null;
  cheapestNow: { priceNum: number; storeIds: string[] } | null;
  offersNow: EmailPackOfferV1[];
};

export type EmailPackEventV1 = {
  id: string;
  marketId: string; // eventType|sku
  eventType: EmailEventType;
  sku: string;

  storeId: string;
  storeLabel: string;
  listingUrl: string;

  // market indicators
  marketNew: boolean;
  marketReturn: boolean;
  marketOut: boolean;
  baseInStockCount: number;
  headInStockCount: number;

  // PRICE_DROP only
  oldPrice?: string;
  newPrice?: string;
  dropAbs?: number;
  dropPct?: number | null;
  isCheapestNow?: boolean;
};

export type EmailEventPackV1 = {
  version: 1;
  generatedAt: string;
  range?: { fromSha: string; toSha: string };
  stats?: any;
  skus: Record<string, EmailPackSkuV1>;
  events: EmailPackEventV1[];
};