# whatsapp-mcp

Let your AI agent read your WhatsApp messages.

This is a small server that runs in your own Cloudflare account. You link your phone to it once, the way you'd link WhatsApp Web, and from then on any MCP client (Claude Code, Claude Desktop, anything that speaks MCP) can search and read your chats. It is read-only. It can't send anything.

Ask your agent things like:

- "What did Dana say about the flights?"
- "Find every message where someone mentioned the lease, across all my chats."
- "Summarize what I missed in the family group this week."

## How it works

Your phone stays the source of truth. The server is a linked device that your agent talks to.

It doesn't stay connected to WhatsApp. When your agent asks for something, and once a day, it connects, collects whatever WhatsApp queued for it since last time, writes that to its own database, and hangs up. Your phone keeps working normally and keeps getting notifications.

Your messages live in a SQLite database inside a Durable Object in your Cloudflare account. Nothing goes anywhere else.

## Set it up

You need a Cloudflare account on the Workers Paid plan (see the note below), Node 20 or later, and your phone.

```sh
git clone https://github.com/finereli/whatsapp-mcp
cd whatsapp-mcp
npm install

# 1. A place for the sign-in tokens. Paste the id it prints into wrangler.jsonc.
npx wrangler kv namespace create OAUTH_KV

# 2. A password for the page that links your phone. 12+ characters.
npx wrangler secret put OWNER_PASSWORD

# 3. Deploy.
npm run deploy
```

Wrangler prints your URL, something like `https://whatsapp-mcp.your-name.workers.dev`. Open it. The front page has the two remaining steps:

1. **Link WhatsApp.** Scan the QR code with WhatsApp (Settings, Linked Devices, Link a Device). If you're on the phone itself and can't scan a screen, use the phone number option instead. The first link imports your history. The page shows progress, and you can close it.
2. **Connect your agent.** In Claude Code:

   ```sh
   claude mcp add --transport http whatsapp https://your-url/mcp
   ```

   Then type `/mcp` and sign in with the password. Other clients: point them at the same `/mcp` URL.

If you want your own domain, see the comments at the bottom of `wrangler.jsonc`.

### Sign in with Google, and get names for your chats

A password is the simplest way in. Google sign-in is better if you want your contacts' names on chats, because the same login also lets the server read your Google contacts (read-only). You need a Google Cloud project of your own:

1. Create a project and enable the **People API**.
2. Under Google Auth Platform, create an **OAuth client** of type "Web application". Add `https://your-domain/callback/google` as an authorized redirect URI. It has to be a domain you control, not a `localhost` address.
3. Add the scopes `contacts.readonly` and `contacts.other.readonly`. Add yourself as a test user.
4. **Publish the app** ("In production"). Google shows a warning that it isn't verified, which is fine for a single user. If you leave it in "Testing", Google expires the contacts access after 7 days and names stop updating.
5. Give the Worker the client and your email:

   ```sh
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

   and in `wrangler.jsonc` add `"vars": { "OWNER_EMAIL": "you@gmail.com", "DEFAULT_COUNTRY_CODE": "1" }`. The country code (digits, no plus) is only used for numbers in your contacts that Google can't place on its own.

Then open `/setup` and sign in. Contacts refresh on every sign-in, on the daily pull, and when your agent calls `sync_now`.

### The Workers Paid note

Importing a large history decodes a lot of data in one go, and the default CPU limit on Workers is too small for it. `wrangler.jsonc` raises it, and raising it needs the paid plan, which is a few dollars a month. I haven't tried the free plan. If you're on it, remove the `limits` block and expect the first import to be fragile.

## Things to know

**This isn't official.** WhatsApp has no API for reading your own personal messages. This uses the same protocol WhatsApp Web uses, through an open source library (Baileys). That's against WhatsApp's terms. For a linked device that only reads, the practical risk is low, but it isn't zero. Use it on your own account, and don't use it to send messages.

**You get what WhatsApp sends.** The first link imports whatever history WhatsApp decides to hand a new device. It may not be everything. It only does this once per link. To import again, relink (your stored messages are kept, and a re-import fills in anything missing).

**Some chats show up as phone numbers.** WhatsApp doesn't give a linked device every contact name. Chats with people it has no name for show as a number. If you sign in with Google (see below), the server reads your Google contacts and matches them to chats by phone number, which fills most of these in.

**Media isn't downloaded.** Photos, voice notes and documents appear as labels like `[image]` or `[voice note 12s]`, with the caption if there was one. Nothing is transcribed.

**It's for one person.** One deployment is one WhatsApp account and one owner. That's deliberate: each deployment holds a full message history and a live login to the account, so everyone should run their own.

**Relinking.** If your phone says the device was removed, or you want to start over, ask your agent to run `relink`, or open `/setup` and choose "Unlink and scan again". You scan a new QR code. Stored messages are kept.

## What your agent can do

| Tool | What it does |
| --- | --- |
| `list_chats` | Chats, most recent first. Filter by name or number. |
| `get_messages` | Read one chat. Page back or forward by date. |
| `search_messages` | Full-text search across everything, or within one chat. |
| `sync_now` | Pull new messages right now. |
| `link_status` | Is it linked, when did it last pull, how much is stored. |
| `relink` | Unlink and start over. A human has to scan the new QR code. |

Every read tool first tops up from WhatsApp if the stored copy is more than ten minutes old.

---

# For agents, and people adapting this

Everything below is for whoever is changing the code, including an AI agent working on a fork. The top of this file is for the person who owns the deployment.

## Shape of the thing

```
MCP client ──OAuth──> Worker (src/index.ts)
                        ├─ /mcp ───────────> mcp.ts: tools, one fresh McpServer per request
                        ├─ /, /setup, /authorize, /login/*, /pair/*   (landing, sign-in, pairing UI)
                        └─ cron 04:00 UTC ──> pull()
                                   │ RPC
                                   v
              WhatsAppStore (Durable Object, one instance named "owner")
                ├─ SQLite: auth keys, messages, chats, contacts, FTS5 index
                └─ Baileys socket, opened only during a session (pairing or pull)
                                   │ WebSocket
                                   v
                              WhatsApp servers
```

One Durable Object holds everything. Its SQLite is both the Baileys auth store and the message store. The Worker is stateless apart from a KV namespace the OAuth provider uses for tokens and a short-lived "pending sign-in" record.

## Files

| File | Job |
| --- | --- |
| `src/index.ts` | Routes. OAuth provider wiring, sign-in, pairing endpoints, `/debug`, cron. |
| `src/auth.ts` | Who counts as the owner. Three modes: Google, a login service, or a password. |
| `src/google.ts` | Google sign-in, token refresh, and reading contacts with phone-number normalization. |
| `src/whatsapp-do.ts` | The Durable Object. Runs Baileys sessions, exposes RPC methods for the Worker. |
| `src/store.ts` | Schema, ingesting Baileys events into SQLite, and every query. |
| `src/auth-state.ts` | Baileys auth state backed by the DO's SQLite (replaces `useMultiFileAuthState`). |
| `src/mcp.ts` | The MCP tools. |
| `src/pages.ts`, `src/landing.ts`, `src/ui.ts` | All HTML. `ui.ts` has the shared design tokens. |
| `src/ws-shim.ts`, `src/lru-shim.ts`, `src/polyfills.ts` | Make Baileys run on workerd. See below. |
| `scripts/vendor-bridge.mjs` | Extracts the wasm from Baileys' Rust bridge. Runs on `npm install`. |
| `local-export/` | A separate one-off script that dumps your history to JSON files with no server. Not part of the deployment. |

## How sessions work

All WhatsApp traffic happens inside `runSession()` in `whatsapp-do.ts`. There are two kinds:

- **Pairing** (`startPairing`). No credentials yet. Baileys emits QR strings, kept in memory and rendered to SVG by `pairStatus()`. After a scan WhatsApp closes the socket with code 515 (restart required), and the session reconnects with the new credentials. History arrives as `messaging-history.set` chunks with a `progress` percentage. The session ends when WhatsApp reports 100 percent and the stream has been quiet for a few seconds.
- **Pull** (`pull`). Reconnects with stored credentials. WhatsApp delivers whatever it queued while we were away, then signals `receivedPendingNotifications`. The session ends after a few quiet seconds.

Callers share one session: a second `pull()` while one is running gets the same promise.

A pairing session outlives the HTTP request that started it. `startPairing` sets a Durable Object alarm, and `alarm()` awaits the session promise. An in-flight alarm handler is what keeps the object alive. The pairing page only watches; closing it doesn't stop the import.

Idle detection counts only data events (`messaging-history.set`, `messages.upsert`), not connection chatter. Counting everything keeps a session open forever, because presence and contact updates never stop.

## Data model

All in the Durable Object's SQLite (`store.ts`, `initSchema`).

- `messages(chat, id, ts, from_me, sender, push_name, type, body)`, primary key `(chat, id)`. Media is a label in `body`. Edits update `body`; deletes set it to `[deleted]`.
- `messages_fts`, an FTS5 index over `body`, kept in sync by triggers.
- `chats(jid, name, is_group)` and `contacts(jid, name, notify)`. Display names resolve by chat name, then contact name, then push name, then the number.
- `alias(lid, pn)`. WhatsApp is moving to anonymous `@lid` identifiers. This maps them to phone-number JIDs, and `addAlias` folds existing rows into the phone-number form so one person is one chat.
- `auth(k, v)`, Baileys credentials and signal keys, JSON with Buffers encoded by Baileys' `BufferJSON`.
- `meta(k, v)`, currently just `last_pull`.

Ingest is idempotent. Re-importing history upserts: it fills in a missing `sender` or `push_name` and never duplicates. That is what makes relinking safe.

## What to know before changing things

These all cost real time to find. Read them before touching the Baileys parts.

1. **Baileys needs three shims to run on workerd.**
   - `ws`: the package needs Node sockets. `ws-shim.ts` wraps the Workers WebSocket, opened with `fetch()` and an `Upgrade` header because that's the only way to set the `Origin` header WhatsApp checks.
   - `whatsapp-rust-bridge`: it ships its wasm as base64 and compiles it at runtime, which workerd forbids. `vendor-bridge.mjs` writes the wasm to a file and patches the loader to import it as a `CompiledWasm` module. The `vendor/` folder is generated, not committed.
   - Timers: Node timers have `.unref()` and workerd's don't. `polyfills.ts` adds it. It must be the first import in both the Worker and the Durable Object module.
2. **`lru-cache` autopurge breaks the first import.** Baileys creates caches with `ttlAutopurge: true`, which starts one `setTimeout` per entry. workerd allows 10,000 pending timers per object, and the first history sync blows through that with `QuotaExceededError`. `lru-shim.ts` turns autopurge off. Expired entries are still dropped lazily on access.
3. **QR pairing never sets `creds.registered`.** That flag belongs to the mobile registration flow. "Is this linked" is `creds.me?.id`.
4. **History comes once per link.** If a first import fails halfway, that history is gone until you relink. Don't ship a change to ingest code without testing it against a real first link.
5. **Group senders arrive in two places.** Live messages have `key.participant`. History messages put it on `msg.participant`. Read both.
6. **Pin Baileys exactly.** It's a prerelease and its API moves between release candidates.
7. **Deploys don't evict a busy Durable Object.** An object with an active session keeps running old code until the session ends. Renaming the class with a migration didn't evict it either. If you've shipped a fix and the object still misbehaves, wait for the session's time cap (10 minutes) or check that it's idle.
8. **Logging out takes two steps.** `logout()` first connects and calls Baileys' `logout()`, so the device disappears from the phone's list, then clears local credentials. If the first step fails it says so in the debug events, and the user has to remove the device by hand.
9. **Don't call `markOnlineOnConnect`.** It's set to false on purpose. Marking the linked device online makes the phone stop showing notifications.

## Configuration

| Name | Kind | Purpose |
| --- | --- | --- |
| `OWNER_PASSWORD` | secret | Password mode (default). 12+ characters or sign-in refuses. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | secrets | Set these to switch to Google mode. Takes priority over the other two modes. |
| `OWNER_EMAIL` | var | Google and login-service modes: the one email allowed in. |
| `DEFAULT_COUNTRY_CODE` | var, optional | Google mode: country code for contact numbers Google can't place, e.g. `972`. |
| `LOGIN_ORIGIN` | var | Set this to switch to login-service mode. |
| `ALLOWED_ORIGINS` | var | Login-service mode: comma-separated origins whose tokens are accepted. Production should list only production. |
| `PIN` | secret, optional | 32+ random characters. Enables the `/debug` routes via an `x-pin` header. Leave it unset to leave them off. |
| `OAUTH_KV` | binding | Token store for the OAuth provider and pending sign-ins. |
| `WA` | binding | The Durable Object. |

Keep a deployment's own values (domain, KV id, email) in `wrangler.local.jsonc`, which is gitignored, and deploy with `npm run deploy:local`. `wrangler.jsonc` is the template other people start from.

## Adapting it

- **Add a tool.** Register it in `mcp.ts` and put the SQL in `store.ts`. Read tools should call `fresh()` first. Keep tools read-only unless you mean otherwise.
- **Change who can sign in.** `auth.ts` picks a mode (`authMode`) and the routes in `index.ts` follow it. To add another identity provider, add a mode there and a callback route. The rest of the code only sees an opaque bearer token.
- **Make it multi-user.** Today the Durable Object is addressed by the fixed name `owner` (`wa()` in `index.ts`, `handleMcp` in `mcp.ts`), and `userId` is the constant `'owner'` in the OAuth props. To go multi-user, derive both from the signed-in identity and key the object on it. Think about whether you want to hold other people's message history first.
- **Contacts from somewhere else.** `google.ts` fetches names and `store.replaceGoogleContacts` keeps them in their own table, keyed by WhatsApp jid. Name resolution prefers WhatsApp's chat name, then WhatsApp's contact name, then the Google name, then the person's own push name, then the number. Another source (a CSV, CardDAV) only needs to produce `{ jid, name }` rows.
- **Sending messages.** Not built, on purpose. Think hard before adding it.

## Debugging

With `PIN` set, these return JSON and need the header `x-pin: <PIN>`:

- `/debug`: session phase, linked or not, counts, and the last events from the session (connection changes, history chunk sizes, errors).
- `/debug/pull`: run a pull now.
- `/debug/chats?q=`, `/debug/messages?chat=`, `/debug/search?q=`, `/debug/types`: read the store without going through MCP.
- `/debug/contacts`: Google contacts status. Add `?sync=1` to run a sync now.
- `/debug/logout`: the same as `relink`.

Local development: `npm run dev` with a `.dev.vars` containing `OWNER_PASSWORD=...` (12+ characters). It runs a local Durable Object with its own empty storage, so you can exercise the sign-in flow and see a real QR code, but linking a phone from local dev makes a second linked device.

To test the pairing UI states without a phone, serve the page with a mocked `/pair/status`. Everything the page needs is that one JSON shape: `paired`, `running`, `progress`, `qrSvg`, `messages`, `chats`.

## Checking a change

1. `npm run typecheck`
2. Deploy, then `GET /debug` with the PIN. It should come back with `phase: "idle"` and `paired: true`.
3. `GET /debug/pull`. A quiet account should return `reason: "idle"` in about ten seconds.
4. Call `list_chats`, then `get_messages` on a Hebrew or emoji-heavy chat, then `search_messages`.
5. If you touched ingest, relink and confirm the stored message count doesn't grow (re-import is idempotent) and that group messages show real sender names.

## Known gaps

- Chats with no name anywhere (not in WhatsApp, not in your Google contacts) show as phone numbers. Numbers Google stores without a country code need `DEFAULT_COUNTRY_CODE`.
- Contacts access dies after 7 days if the Google app is left in "Testing". `link_status` reports it when the daily sync fails; signing in again fixes it.
- If the daily pull finds the session logged out, nothing tells you. `link_status` shows it the next time your agent asks.
- Edits and deletes are applied when they arrive as protocol messages. That path hasn't been tested against real ones.
- It's only been exercised against one real account.

## License

MIT
