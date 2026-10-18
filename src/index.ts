/**
 * whatsapp-mcp - a read-only MCP server over your own WhatsApp history.
 *
 * OAuth (workers-oauth-provider) fronts /mcp. Approving a client means signing in
 * as the owner (see auth.ts); if WhatsApp isn't linked yet, the same flow continues
 * into the pairing screen, so a first connection links the phone and a later one
 * just signs in.
 */
import './polyfills.js';
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { WhatsAppStore } from './whatsapp-do.js';
import { handleMcp } from './mcp.js';
import { consentPage, loginPage, messagePage, pairPage } from './pages.js';
import { landingPage } from './landing.js';
import { privacyPage } from './privacy.js';
import { tosPage } from './tos.js';
import {
  isOwnerToken, mintSession, peekPending, sessionCookie, sessionToken, SESSION_COOKIE, signInLabel, startSignIn,
  takePending, tokenFromLoginCode, tokenFromPassword, usesLoginService,
  type AuthEnv,
} from './auth.js';

export { WhatsAppStore };

export interface Env extends AuthEnv {
  WA: DurableObjectNamespace<WhatsAppStore>;
  OAUTH_PROVIDER: OAuthHelpers;
  /** Optional secret for machine access to /debug. 32+ random characters. */
  PIN?: string;
  /** Shown on the privacy page as who runs this server. Optional. */
  OPERATOR_NAME?: string;
  /** Country code (digits, no +) for phone numbers given without one, e.g. "972". */
  DEFAULT_COUNTRY_CODE?: string;
}

const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
const wa = (env: Env) => env.WA.get(env.WA.idFromName('owner'));
const b64 = (o: unknown) => btoa(JSON.stringify(o));
const unb64 = (s: string) => JSON.parse(atob(s));
const cookieValue = (r: Request, name: string) => r.headers.get('cookie')?.split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
const bearer = (r: Request) => r.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
const plain = (title: string, msg: string, status: number) => html(messagePage(title, msg), status);

function pinOk(request: Request, env: Env) {
  const sent = request.headers.get('x-pin');
  if (!sent || !env.PIN || env.PIN.length < 32 || sent.length !== env.PIN.length) return false;
  let diff = 0;
  for (let i = 0; i < sent.length; i++) diff |= sent.charCodeAt(i) ^ env.PIN.charCodeAt(i);
  return diff === 0;
}

async function completeOauth(env: Env, oauth: unknown) {
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauth as any, userId: 'owner', scope: ['whatsapp'], metadata: {}, props: { userId: 'owner' },
  });
  return redirectTo;
}

/** The owner is verified. Remember this browser, then finish the MCP grant if WhatsApp is linked, else go on to pairing. */
async function proceed(env: Env, pendingId: string, token: string): Promise<Response> {
  const pending = await takePending(env, pendingId);
  if (!pending) return plain('Sign-in expired', 'Start again from the app that asked.', 400);
  const session = await mintSession(env, token);
  const remember = (res: Response) => {
    const out = new Response(res.body, res);
    if (session) out.headers.append('set-cookie', sessionCookie(session.value, session.maxAge));
    return out;
  };
  if (pending.oauth && (await wa(env).isPaired())) return remember(new Response(null, { status: 302, headers: { location: await completeOauth(env, pending.oauth) } }));
  return remember(html(pairPage(token, pending.oauth ? b64(pending.oauth) : null)));
}

const signedInToken = (request: Request, env: Env, origin: string) => sessionToken(env, origin, cookieValue(request, SESSION_COOKIE));

const ownerHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const p = url.searchParams.get('p') ?? '';

    // The owner, signed in, lands on their dashboard. Everyone else gets the front page.
    if (path === '/') {
      const token = await signedInToken(request, env, url.origin);
      return html(token ? pairPage(token, null) : landingPage(url.origin));
    }
    if (path === '/privacy') return html(privacyPage(env.OPERATOR_NAME));
    if (path === '/tos') return html(tosPage(env.OPERATOR_NAME));
    if (path === '/signout') return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': sessionCookie('', 0) } });

    // An MCP client wants in: show who is asking, then send the owner to sign in.
    if (path === '/authorize') {
      const oauth = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      const client = await env.OAUTH_PROVIDER.lookupClient(oauth.clientId);
      return html(consentPage(client?.clientName ?? 'An app', await startSignIn(env, url.origin, { oauth }), signInLabel(env)));
    }
    if (path === '/setup') {
      return (await signedInToken(request, env, url.origin))
        ? Response.redirect(`${url.origin}/`, 302)
        : Response.redirect(await startSignIn(env, url.origin, {}), 302);
    }

    // Password mode: the form, then the check.
    if (path === '/login/password' && !usesLoginService(env)) {
      if (!(await peekPending(env, p))) return plain('Sign-in expired', 'Start again from the setup page.', 400);
      if (request.method !== 'POST') return html(loginPage(url.pathname + url.search));
      const token = await tokenFromPassword(env, String((await request.formData()).get('password') ?? ''));
      if (!token) return html(loginPage(url.pathname + url.search, 'Wrong password.'), 401);
      return proceed(env, p, token);
    }

    // Login service mode: back from the service with a one-time code.
    if (path === '/login/return' && usesLoginService(env)) {
      const code = url.searchParams.get('finereli_code');
      if (!code) return plain('Sign-in cancelled', 'Nothing was linked.', 401);
      const token = await tokenFromLoginCode(env, url.origin, code);
      if (!token) return plain('Not your server', 'This server belongs to someone else.', 403);
      return proceed(env, p, token);
    }

    if (path.startsWith('/pair/')) {
      if (!(await isOwnerToken(env, url.origin, bearer(request)))) return json({ error: 'unauthorized' }, 401);
      if (path === '/pair/status') return json(await wa(env).pairStatus());
      if (path === '/pair/start' && request.method === 'POST') {
        if (!(await wa(env).isPaired())) await wa(env).startPairing();
        return json({ ok: true });
      }
      if (path === '/pair/relink' && request.method === 'POST') {
        await wa(env).logout();
        return json({ ok: true });
      }
      if (path === '/pair/code' && request.method === 'POST') {
        const { phone } = (await request.json()) as { phone: string };
        try { return json({ code: await wa(env).requestPairingCode(phone) }); }
        catch (e: any) { return json({ error: e?.message ?? 'failed' }, 500); }
      }
      if (path === '/pair/finish' && request.method === 'POST') {
        const { req } = (await request.json()) as { req: string };
        return json({ redirectTo: await completeOauth(env, unb64(req)) });
      }
    }

    if (path.startsWith('/debug')) {
      if (!pinOk(request, env)) return new Response('unauthorized', { status: 401 });
      try { return await debugRoute(path, url, env); } catch (e: any) { return json({ error: String(e?.message ?? e) }, 500); }
    }

    return new Response('Not found', { status: 404 });
  },
};

/** Machine-readable peeks for whoever is debugging a deployment. Guarded by the PIN secret. */
async function debugRoute(path: string, url: URL, env: Env): Promise<Response> {
  const q = url.searchParams;
  if (path === '/debug/pull') return json(await wa(env).pull().catch((e) => ({ error: String(e) })));
  if (path === '/debug/chats') return json(await wa(env).listChats(q.get('q') ?? undefined, 10));
  if (path === '/debug/unnamed') return json(await wa(env).unnamedChats(Number(q.get('limit') ?? 10)));
  if (path === '/debug/sql') return json(await wa(env).select(q.get('q') ?? ''));
  if (path === '/debug/types') return json(await wa(env).typeCounts());
  if (path === '/debug/search') return json(await wa(env).search({ query: q.get('q') ?? '', limit: 5 }));
  if (path === '/debug/messages') {
    const [c] = await wa(env).resolveChat(q.get('chat') ?? '');
    return json(c ? { chat: c, rows: await wa(env).getMessages({ chat: c.jid, limit: 8 }) } : { error: 'no chat' });
  }
  if (path === '/debug/logout') { await wa(env).logout(); return json({ ok: true }); }
  return json(await wa(env).debug());
}

const oauth = new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: { fetch: (request: Request, env: Env) => handleMcp(request, env) } as any,
  defaultHandler: ownerHandler as any,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  scopesSupported: ['whatsapp'],
  refreshTokenTTL: 10 * 365 * 24 * 60 * 60,
});

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => oauth.fetch(request, env, ctx),

  /** Daily pull, so WhatsApp's per-device queue never has time to age out. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const stub = wa(env);
        if (await stub.isPaired()) console.log('daily pull', await stub.pull());
      })(),
    );
  },
};
