/**
 * How big an account may get. On a service for many people each account's size is capped, so one huge history
 * can't crowd out the rest. A copy for one person has no caps unless you set them. 0 means no cap.
 *
 * A history that is too big when first linked is turned away (everything received is deleted, the phone is
 * unlinked). An account that grows past the cap later just stops taking new messages and keeps what it has.
 */
import type { AuthEnv } from './auth.js';

export type Mode = 'single' | 'multi' | 'unset';
/** One person (OWNER_PASSWORD), many people (OPEN_SIGNUP), or not set up, in which case nobody can sign in. */
export const serverMode = (env: Pick<AuthEnv, 'OWNER_PASSWORD' | 'OPEN_SIGNUP'>): Mode =>
  env.OWNER_PASSWORD ? 'single' : env.OPEN_SIGNUP === 'true' ? 'multi' : 'unset';

export interface Limits { messages: number; bytes: number }

const DEFAULT_MESSAGES = 250_000;
const DEFAULT_MB = 300;

const num = (v: string | undefined, fallback: number) => {
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export function limitsOf(env: AuthEnv): Limits {
  const many = serverMode(env) === 'multi';
  return { messages: num(env.MAX_MESSAGES, many ? DEFAULT_MESSAGES : 0), bytes: num(env.MAX_DB_MB, many ? DEFAULT_MB : 0) * 1024 * 1024 };
}

/** What to do about an account of this size: turn it away while it is being linked, or stop adding to it afterwards. */
export function verdict(now: { messages: number; bytes: number }, lim: Limits, linking: boolean): 'reject' | 'pause' | null {
  const over = (lim.messages > 0 && now.messages > lim.messages) || (lim.bytes > 0 && now.bytes > lim.bytes);
  return over ? (linking ? 'reject' : 'pause') : null;
}
