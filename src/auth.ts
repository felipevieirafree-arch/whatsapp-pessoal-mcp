/**
 * Who someone is, and how their data key travels with them. Two modes, picked by config:
 *
 *   - Single user (set the OWNER_PASSWORD secret): one account named "owner", for people running their own copy.
 *     The first sign-in with OWNER_PASSWORD creates the account; after that the account's own password is what
 *     counts (it starts out the same).
 *   - Many users (leave OWNER_PASSWORD unset and set SIGNUP_CODE, or OPEN_SIGNUP=true): people sign up with an
 *     email and a password. The code keeps signups invite-only. The email is only a name for the login; nothing
 *     is ever sent to it.
 *   - Neither: nobody can sign in. A fresh deployment that forgot to pick a mode must not turn into a free
 *     service for strangers.
 *
 * Either way a password is what unlocks the user's data (see vault.ts), so a sign-in produces the data key and
 * the key is carried from there inside tokens: the OAuth grant for agents, and a session for the browser. Both
 * keep it encrypted under the token itself, so the server stores nothing that can open a user's data on its own.
 */
import { createHash } from 'node:crypto';
import { createAccount, newToken, openAccount, tokenId, unwrapForToken, wrapForToken } from './vault.js';
import type { AccountRecord } from './vault.js';
import type { WhatsAppStore } from './whatsapp-do.js';
import type { Registry } from './registry.js';
import { serverMode } from './limits.js';

export interface AuthEnv {
  OAUTH_KV: KVNamespace;
  WA: DurableObjectNamespace<WhatsAppStore>;
  REGISTRY: DurableObjectNamespace<Registry>;
  OWNER_PASSWORD?: string;
  SIGNUP_CODE?: string;
  /** "true" to let anyone sign up when there is no SIGNUP_CODE. Many-user mode has to be asked for. */
  OPEN_SIGNUP?: string;
  /** Most accounts the service will have (many-user mode). 0 or unset: no cap. */
  SIGNUP_LIMIT?: string;
  /** A URL that takes a plain-text POST and pushes it to the operator's phone, such as an ntfy.sh topic. */
  NOTIFY_URL?: string;
  /** The operator's X handle, shown where people are told to get in touch. */
  CONTACT_X?: string;
  /** Per-account caps for many-user mode (see limits.ts). 0 means no cap. */
  MAX_MESSAGES?: string;
  MAX_DB_MB?: string;
  /** IANA zone for the single user's timestamps. Defaults to the zone of the browser that first signed in. */
  TIMEZONE?: string;
}

export interface Identity { userId: string; dek: Buffer }

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const randomId = () => hex(crypto.getRandomValues(new Uint8Array(16)).buffer);

/** Constant-time string comparison (hash both sides first so lengths don't leak). */
export async function sameSecret(a: string, b: string) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return (crypto.subtle as any).timingSafeEqual(x, y) as boolean;
}

export const isSingleUser = (env: AuthEnv) => Boolean(env.OWNER_PASSWORD);
export { serverMode };
export type { Mode } from './limits.js';
export const NOT_SET_UP = 'This server has no sign-in configured. Its owner needs to set OWNER_PASSWORD (for one person), or SIGNUP_CODE or OPEN_SIGNUP (for many).';
export const MIN_PASSWORD = 12;

const normEmail = (e: string) => e.trim().toLowerCase();
const looksLikeEmail = (e: string) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** One Durable Object per person, found by a hash of their email. */
export const userIdFor = (env: AuthEnv, email: string) =>
  isSingleUser(env) ? 'owner' : createHash('sha256').update(`whatsapp-mcp:${normEmail(email)}`).digest('hex').slice(0, 32);

export const seatRegistry = (env: AuthEnv) => env.REGISTRY.get(env.REGISTRY.idFromName('seats'));

export const accountStub = (env: AuthEnv, userId: string) => env.WA.get(env.WA.idFromName(userId));

/** The same stub, unlocked with the person's data key. */
export async function unlockedStub(env: AuthEnv, who: Identity | { userId: string; dek: string }) {
  const stub = accountStub(env, who.userId);
  await stub.unlock(typeof who.dek === 'string' ? who.dek : who.dek.toString('base64'));
  return stub;
}

// ---------- sign-in steps that wait on a page ----------

/** Park what we need after sign-in, and return the URL that starts it. */
export async function startSignIn(env: AuthEnv, origin: string, pending: { oauth?: unknown }): Promise<string> {
  const id = randomId();
  await env.OAUTH_KV.put(`pending:${id}`, JSON.stringify(pending), { expirationTtl: 3600 });
  return `${origin}/login?p=${id}`;
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

// ---------- passwords ----------

export type Attempt = { ok: true; who: Identity; seats?: { taken: number; limit: number } } | { ok: false; error: string; status: number; full?: boolean };
const fail = (error: string, status = 401): Attempt => ({ ok: false, error, status });

let decoy: AccountRecord | null = null;

/** Check a login, creating the single user's account on its first sign-in. */
export async function signIn(env: AuthEnv, form: { email?: string; password: string }, timezone: string): Promise<Attempt> {
  const { password } = form;
  if (serverMode(env) === 'unset') return fail(NOT_SET_UP, 503);
  const single = isSingleUser(env);
  if (!single && !looksLikeEmail(normEmail(form.email ?? ''))) return fail('Enter the email you signed up with.', 400);
  const userId = userIdFor(env, form.email ?? '');
  const stub = accountStub(env, userId);

  const { record, retryAfter } = await stub.account();
  if (retryAfter > 0) return fail(`Too many wrong passwords. Try again in ${Math.ceil(retryAfter / 1000)} seconds.`, 429);

  if (!record) {
    if (single && env.OWNER_PASSWORD!.length >= MIN_PASSWORD && (await sameSecret(password, env.OWNER_PASSWORD!))) {
      const made = await createAccount(password);
      if (await stub.createAccount(made.record, env.TIMEZONE ?? timezone)) return { ok: true, who: { userId, dek: made.dek } };
      return signIn(env, form, timezone); // lost a race with another first sign-in; it exists now
    }
    // Spend the same time as a real check, so an unknown email isn't distinguishable from a wrong password.
    decoy ??= (await createAccount('decoy')).record;
    await openAccount(password, decoy);
    if (single) await stub.noteLogin(false); // an unknown email has no object worth creating just to count its failures
    return fail(single ? 'Wrong password.' : 'Wrong email or password.');
  }

  const dek = await openAccount(password, record);
  await stub.noteLogin(Boolean(dek));
  return dek ? { ok: true, who: { userId, dek } } : fail(single ? 'Wrong password.' : 'Wrong email or password.');
}

export async function signUp(env: AuthEnv, form: { email: string; password: string; code?: string }, timezone: string): Promise<Attempt> {
  if (serverMode(env) !== 'multi') return fail(isSingleUser(env) ? 'This server is for one person.' : NOT_SET_UP, 403);
  const email = normEmail(form.email);
  if (!looksLikeEmail(email)) return fail('That doesn\'t look like an email address.', 400);
  if (form.password.length < MIN_PASSWORD) return fail(`Choose a password of at least ${MIN_PASSWORD} characters.`, 400);
  if (env.SIGNUP_CODE && !(await sameSecret(form.code ?? '', env.SIGNUP_CODE))) return fail('That invite code isn\'t right.', 403);
  const limit = Number(env.SIGNUP_LIMIT) > 0 ? Number(env.SIGNUP_LIMIT) : 0;
  const registry = env.REGISTRY.get(env.REGISTRY.idFromName('seats'));
  const seat = await registry.claim(limit);
  if (!seat.ok) return { ok: false, error: `This service is full: it takes ${limit} people for now.`, status: 503, full: true };
  const made = await createAccount(form.password);
  const userId = userIdFor(env, email);
  if (!(await accountStub(env, userId).createAccount(made.record, timezone))) {
    await registry.release();
    return fail('That email already has an account. Sign in instead.', 409);
  }
  return { ok: true, who: { userId, dek: made.dek }, seats: { taken: seat.count, limit } };
}

// ---------- sessions: a token that carries the key ----------

const SESSION_KEY = 'sess:';

/** File the identity under a fresh token. The token is the only thing that can open the stored copy of the key. */
export async function mintSession(env: AuthEnv, who: Identity, ttlSeconds: number): Promise<string> {
  const { token, id } = newToken();
  await env.OAUTH_KV.put(SESSION_KEY + id, JSON.stringify({ u: who.userId, k: wrapForToken(token, who.dek) }), { expirationTtl: Math.max(60, ttlSeconds) });
  return token;
}

export async function readSession(env: AuthEnv, token: string | undefined): Promise<Identity | null> {
  if (!token) return null;
  const raw = await env.OAUTH_KV.get(SESSION_KEY + tokenId(token));
  if (!raw) return null;
  const { u, k } = JSON.parse(raw) as { u: string; k: string };
  const dek = unwrapForToken(token, k);
  return dek ? { userId: u, dek } : null;
}

// ---------- the browser ----------

export const SESSION_COOKIE = 'wa_session';
export const COOKIE_SECONDS = 14 * 86_400;
export const PAGE_SECONDS = 30 * 60;

export const sessionCookie = (value: string, maxAge: number) =>
  `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
