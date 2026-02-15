export interface Env {
  KV: KVNamespace;
  JWT_SECRET: string; // Worker secret
  JWT_ISS: string;
  JWT_AUD: string;
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
