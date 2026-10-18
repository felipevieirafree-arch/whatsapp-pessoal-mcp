/**
 * Google, for two jobs: signing in the owner, and reading their contacts so chats that WhatsApp
 * only knows by number get the name the owner gave them. One grant covers both. The refresh token
 * is kept in the Durable Object next to the WhatsApp session, and the daily pull uses it.
 *
 * Needs a Google Cloud project with the People API enabled and a "Web application" OAuth client
 * whose redirect URI is https://<your-domain>/callback/google. See the README.
 */

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';
const PEOPLE = 'https://people.googleapis.com/v1';

export const SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/contacts.readonly',
  // people the owner has talked to but never saved; WhatsApp chats are often with these
  'https://www.googleapis.com/auth/contacts.other.readonly',
].join(' ');

export interface GoogleEnv { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; OWNER_EMAIL?: string }

export function signInUrl(env: GoogleEnv, origin: string, state: string): string {
  const u = new URL(AUTH);
  u.searchParams.set('client_id', env.GOOGLE_CLIENT_ID!);
  u.searchParams.set('redirect_uri', `${origin}/callback/google`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('access_type', 'offline'); // we want a refresh token
  u.searchParams.set('prompt', 'consent');      // and Google only issues one when asked every time
  u.searchParams.set('state', state);
  if (env.OWNER_EMAIL) u.searchParams.set('login_hint', env.OWNER_EMAIL);
  return u.toString();
}

async function tokenRequest(env: GoogleEnv, params: Record<string, string>) {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, ...params }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) throw new GoogleError(body.error_description ?? body.error ?? `token request failed (${res.status})`, body.error);
  return body;
}

export class GoogleError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

/** Trade the one-time code for tokens and learn who signed in. */
export async function completeSignIn(env: GoogleEnv, origin: string, code: string) {
  const t = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: `${origin}/callback/google` });
  const info = await fetch(USERINFO, { headers: { authorization: `Bearer ${t.access_token}` } }).then((r) => r.json() as Promise<Record<string, any>>);
  return {
    accessToken: t.access_token as string,
    refreshToken: t.refresh_token as string | undefined,
    scope: String(t.scope ?? ''),
    email: String(info.email ?? ''),
    emailVerified: Boolean(info.email_verified),
  };
}

export async function refreshAccessToken(env: GoogleEnv, refreshToken: string): Promise<string> {
  return (await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: refreshToken })).access_token;
}

/**
 * A phone number as WhatsApp spells it: digits with the country code, then @s.whatsapp.net.
 * Google usually gives a canonical +E.164 form; when it doesn't, a leading 0 is a national
 * trunk prefix and gets replaced with `defaultCc`.
 */
export function toJid(raw: string, canonical: string | undefined, defaultCc: string | undefined): string | null {
  const text = (canonical || raw || '').trim();
  let digits = text.replace(/\D/g, '');
  if (!digits) return null;
  if (!text.startsWith('+')) {
    if (digits.startsWith('00')) digits = digits.slice(2);
    else if (!defaultCc) return null;                            // can't tell the country, so don't guess
    else if (digits.startsWith('0')) digits = defaultCc + digits.slice(1);
    else if (digits.length <= 10) digits = defaultCc + digits;   // national number without the trunk 0
  }
  return digits.length >= 8 && digits.length <= 15 ? `${digits}@s.whatsapp.net` : null;
}

interface Person { names?: { displayName?: string }[]; phoneNumbers?: { value?: string; canonicalForm?: string }[] }

async function listAll(url: string, key: 'connections' | 'otherContacts', params: Record<string, string>, accessToken: string): Promise<Person[]> {
  const out: Person[] = [];
  let pageToken = '';
  do {
    const u = new URL(url);
    for (const [k, v] of Object.entries({ ...params, pageSize: '1000', ...(pageToken ? { pageToken } : {}) })) u.searchParams.set(k, v);
    const res = await fetch(u, { headers: { authorization: `Bearer ${accessToken}` } });
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) throw new GoogleError(body.error?.message ?? `people api failed (${res.status})`, body.error?.status);
    out.push(...((body[key] as Person[]) ?? []));
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

/** Every named contact with a phone number, as { jid, name }. Saved contacts win over "other contacts". */
export async function fetchContacts(accessToken: string, defaultCc: string | undefined) {
  const [saved, other] = await Promise.all([
    listAll(`${PEOPLE}/people/me/connections`, 'connections', { personFields: 'names,phoneNumbers' }, accessToken),
    // the owner may have declined the optional scope; that's fine
    listAll(`${PEOPLE}/otherContacts`, 'otherContacts', { readMask: 'names,phoneNumbers' }, accessToken).catch(() => [] as Person[]),
  ]);
  const byJid = new Map<string, string>();
  for (const p of [...saved, ...other]) {
    const name = p.names?.[0]?.displayName?.trim();
    if (!name) continue;
    for (const n of p.phoneNumbers ?? []) {
      const jid = toJid(n.value ?? '', n.canonicalForm, defaultCc);
      if (jid && !byJid.has(jid)) byJid.set(jid, name);
    }
  }
  return { rows: [...byJid].map(([jid, name]) => ({ jid, name })), saved: saved.length, other: other.length };
}
