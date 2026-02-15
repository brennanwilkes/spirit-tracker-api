export interface Env {
  AUTH_KV: KVNamespace;
  JWT_SECRET: string; // Worker secret
  JWT_ISS: string;
  JWT_AUD: string;
  PASSWORD_PEPPER: string; // Worker secret
}

export type EmailIndex = {
  userId: string;
  pwHash: string;
  createdAt: string;
};

export type Details = {
  public: boolean;
  [k: string]: unknown;
};

export type Score = Record<string, number>;
