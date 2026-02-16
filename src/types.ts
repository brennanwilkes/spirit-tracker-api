export interface Env {
  AUTH_KV: KVNamespace;
  JWT_SECRET: string;
  JWT_ISS: string;
  JWT_AUD: string;
  PASSWORD_PEPPER: string;

  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

export type EmailIndex = {
  userId: string;
  pwHash?: string; // optional for OAuth-only accounts
  createdAt: string;
};

export type Details = {
  public: boolean;
  [k: string]: unknown;
};

export type Score = Record<string, number>;
