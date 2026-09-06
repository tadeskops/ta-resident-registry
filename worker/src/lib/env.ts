export interface Env {
  JWT_SECRET: string;
  GH_TOKEN: string;
  GH_OWNER: string;
  GH_REPO: string;
  GH_BRANCH: string;
  MAIL_PROVIDER?: 'resend' | 'mailchannels' | 'noop';
  RESEND_API_KEY?: string;
  MAIL_FROM: string;
  OTP_KV?: KVNamespace;
}

export interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  authEmail?: string;
  authRole?: Role;
}

export type Role = 'UNKNOWN' | 'RESIDENT' | 'MANAGER' | 'ADMIN';
