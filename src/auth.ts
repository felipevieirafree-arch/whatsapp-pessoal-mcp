/**
 * Who counts as the owner. Two ways in, picked by config:
 *
 *   - Password (default): set the OWNER_PASSWORD secret. Simple, works on any domain.
 *   - Login service: set LOGIN_ORIGIN (plus OWNER_EMAIL and ALLOWED_ORIGINS) to sign in
 *     through a Google login service that mints signed tokens, verified in verify-login.ts.
 *
 * Either way the result is an opaque bearer token the pairing page presents to /pair/*.
 * To use a different identity provider, replace the four exports at the bottom.
 */
import { verifyLoginToken } from './verify-login.js';

export interface AuthEnv {
  OAUTH_KV: KVNamespace;
  OWNER_PASSWORD?: string;
  LOGIN_ORIGIN?: string;
  OWNER_EMAIL?: string;
  ALLOWED_ORIGINS?: string;
}

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const randomId = () => hex(crypto.getRandomValues(new Uint8Array(16)).buffer);

async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}

/** Constant-time string comparison (hash both sides first so lengths don't leak). */
export async function sameSecret(a: string, b: string) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return (crypto.subtle as any).timingSafeEqual(x, y) as boolean;
}

export const usesLoginService = (env: AuthEnv) => Boolean(env.LOGIN_ORIGIN);

/** Park what we need after sign-in, and return the URL that starts it. */
export async function startSignIn(env: AuthEnv, origin: string, pending: { oauth?: unknown }): Promise<string> {
  const id = randomId();
  await env.OAUTH_KV.put(`pending:${id}`, JSON.stringify(pending), { expirationTtl: 3600 });
  if (!usesLoginService(env)) return `${origin}/login/password?p=${id}`;
  const start = new URL('/start', env.LOGIN_ORIGIN);
  start.searchParams.set('return', `${origin}/login/return?p=${id}`);
  return start.toString();
}

export async function peekPending(env: AuthEnv, id: string): Promise<{ oauth?: any } | null> {
  const raw = await env.OAUTH_KV.get(`pending:${id}`);
  return raw ? JSON.parse(raw) : null;
}
export async function takePending(env: AuthEnv, id: string) {
  const p = await peekPending(env, id);
  if (p) await env.OAUTH_KV.delete(`pending:${id}`);
  return p;
}

// ---------- the four things to replace for another identity provider ----------

/** Password mode: a good password buys a 30 minute token. */
export async function tokenFromPassword(env: AuthEnv, password: string): Promise<string | null> {
  const secret = env.OWNER_PASSWORD;
  if (!secret || secret.length < 12 || !(await sameSecret(password, secret))) return null;
  const exp = String(Date.now() + 30 * 60_000);
  return `${exp}.${await hmac(secret, `pair:${exp}`)}`;
}

/** Login service mode: trade the one-time code from the return URL for a signed token, if it is the owner's. */
export async function tokenFromLoginCode(env: AuthEnv, origin: string, code: string): Promise<string | null> {
  const res = await fetch(`${env.LOGIN_ORIGIN}/exchange`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }),
  }).catch(() => null);
  const token = res?.ok ? ((await res.json()) as { token?: string }).token : undefined;
  return token && (await isOwnerToken(env, origin, token)) ? token : null;
}

/** Does this bearer token belong to the owner, on this origin? */
export async function isOwnerToken(env: AuthEnv, origin: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  if (!usesLoginService(env)) {
    const [exp, sig] = token.split('.');
    if (!exp || !sig || Number(exp) < Date.now() || !env.OWNER_PASSWORD) return false;
    return sameSecret(sig, await hmac(env.OWNER_PASSWORD, `pair:${exp}`));
  }
  // tokens only count on the origin they were minted for
  if (!(env.ALLOWED_ORIGINS ?? '').split(',').includes(origin) || !env.OWNER_EMAIL) return false;
  const claims = await verifyLoginToken(token, { audience: origin, issuer: env.LOGIN_ORIGIN });
  return Boolean(claims?.email_verified && claims.email.toLowerCase() === env.OWNER_EMAIL.toLowerCase());
}

export const signInLabel = (env: AuthEnv) => (usesLoginService(env) ? 'Sign in with Google to allow' : 'Continue');
