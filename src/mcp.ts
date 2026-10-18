/** The MCP surface: read-only tools over the message store. Each call tops up from WhatsApp first if the store is stale. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import type { Env } from './index.js';
import type { WhatsAppStore } from './whatsapp-do.js';

const TZ = 'Asia/Jerusalem';
const STALE_MS = 10 * 60_000;

const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' });
const when = (ts: number) => fmt.format(new Date(ts * 1000));
const epoch = (s?: string) => {
  if (!s) return undefined;
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`Cannot parse date "${s}" - use ISO format like 2026-03-01`);
  return Math.floor(t / 1000);
};
/** Search results are for skimming; a long broadcast shouldn't flood the context. get_messages has the full text. */
const clip = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}... [+${s.length - n} chars]` : s);
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

type Rows = Record<string, any>[];

function buildServer(wa: DurableObjectStub<WhatsAppStore>, origin: string) {
  const server = new McpServer(
    { name: 'whatsapp-mcp', version: '0.0.1' },
    {
      instructions:
        `Read-only access to the owner's WhatsApp history. Timestamps are ${TZ}. ` +
        `Each call first pulls anything new from WhatsApp if the store is more than a few minutes old. ` +
        `Use list_chats to find a chat, get_messages to read it, search_messages to find things across chats.`,
    },
  );

  /** Top up from WhatsApp; never let a failed pull block reading what we already have. */
  const fresh = async (): Promise<string> => {
    try {
      if (!(await wa.isPaired())) return `WhatsApp is not linked yet. Open ${origin}/setup to scan the QR code.\n\n`;
      await wa.pullIfStale(STALE_MS);
      return '';
    } catch (e: any) {
      return `(could not refresh from WhatsApp: ${e?.message}; showing stored messages)\n\n`;
    }
  };

  server.registerTool(
    'list_chats',
    {
      description: 'List chats (DMs and groups), most recently active first. Optionally filter by name or number fragment.',
      inputSchema: { query: z.string().optional(), limit: z.number().int().min(1).max(100).default(30) },
    },
    async ({ query, limit }) => {
      const note = await fresh();
      const rows = (await wa.listChats(query, limit)) as Rows;
      if (!rows.length) return text(note + 'No chats found.');
      return text(
        note + rows.map((r) => `${r.name}${r.is_group ? ' [group]' : ''} | ${r.messages} msgs | last ${when(r.last_ts)} | ${r.jid}`).join('\n'),
      );
    },
  );

  server.registerTool(
    'get_messages',
    {
      description:
        'Read messages from one chat, oldest first. `chat` is a jid from list_chats or a name/number fragment. ' +
        'By default returns the most recent messages; pass `before` to page back in time or `after` to page forward.',
      inputSchema: {
        chat: z.string(),
        limit: z.number().int().min(1).max(500).default(50),
        before: z.string().optional().describe('ISO date/time; only messages before this'),
        after: z.string().optional().describe('ISO date/time; only messages after this'),
      },
    },
    async ({ chat, limit, before, after }) => {
      const note = await fresh();
      const matches = (await wa.resolveChat(chat)) as { jid: string; name: string }[];
      if (!matches.length) return text(note + `No chat matches "${chat}". Try list_chats.`);
      if (matches.length > 1 && !chat.includes('@')) {
        return text(note + `"${chat}" matches several chats, pick one by jid:\n` + matches.map((m) => `${m.name} | ${m.jid}`).join('\n'));
      }
      const rows = (await wa.getMessages({ chat: matches[0].jid, limit, before: epoch(before), after: epoch(after) })) as Rows;
      const head = `# ${matches[0].name} (${rows.length} messages)\n`;
      return text(note + head + rows.map((r) => `[${when(r.ts)}] ${r.sender}: ${r.body}`).join('\n'));
    },
  );

  server.registerTool(
    'search_messages',
    {
      description: 'Full-text search across all messages (or one chat), newest matches first.',
      inputSchema: {
        query: z.string(),
        chat: z.string().optional().describe('Restrict to one chat (jid or name fragment)'),
        since: z.string().optional(),
        until: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(30),
      },
    },
    async ({ query, chat, since, until, limit }) => {
      const note = await fresh();
      let chatJid: string | undefined;
      if (chat) {
        const m = (await wa.resolveChat(chat)) as { jid: string }[];
        if (!m.length) return text(note + `No chat matches "${chat}".`);
        chatJid = m[0].jid;
      }
      const rows = (await wa.search({ query, chat: chatJid, since: epoch(since), until: epoch(until), limit })) as Rows;
      if (!rows.length) return text(note + 'No matches.');
      return text(note + rows.map((r) => `[${when(r.ts)}] ${r.chat_name} | ${r.sender}: ${clip(r.body)}`).join('\n'));
    },
  );

  server.registerTool(
    'link_status',
    {
      description: 'Is WhatsApp linked, when was the last pull, and how much is stored. Use this first if anything looks wrong.',
      inputSchema: {},
    },
    async () => {
      const i = await wa.linkInfo();
      if (!i.paired) return text(`Not linked. The owner needs to scan a QR code at ${origin}/setup.${i.messages ? ` The ${i.messages} messages already stored are kept.` : ''}`);
      const last = i.lastPull ? when(Math.floor(i.lastPull / 1000)) : 'never';
      const c = await wa.contactsInfo();
      const contacts = c.error
        ? ` Google contacts: ${c.error}`
        : c.connected
          ? ` Google contacts: ${c.names} names matched${c.namedByGoogle ? `, naming ${c.namedByGoogle} chats WhatsApp had no name for` : ''}.`
          : '';
      return text(`Linked. Last pull ${last}. Stored: ${i.messages} messages across ${i.chats} chats.${contacts} To link a different phone or fix a broken session, call relink.`);
    },
  );

  server.registerTool(
    'relink',
    {
      description:
        'Unlink the current WhatsApp session and start over. Stored messages are kept. The owner must then open the returned URL and scan a QR code with their phone, which an agent cannot do for them. ' +
        'Use when link_status says not linked, or the session is broken, or the owner asks to relink or re-import history.',
      inputSchema: {},
      annotations: { destructiveHint: true },
    },
    async () => {
      await wa.logout();
      return text(`Unlinked. Ask the owner to open ${origin}/setup and scan the QR code (WhatsApp > Settings > Linked Devices > Link a Device). History is re-imported on the new link; stored messages are kept.`);
    },
  );

  server.registerTool(
    'sync_now',
    {
      description: 'Force a pull of new messages from WhatsApp right now and report how many arrived.',
      inputSchema: {},
    },
    async () => {
      if (!(await wa.isPaired())) return text(`WhatsApp is not linked yet. Open ${origin}/setup to scan the QR code.`);
      const r = await wa.pull();
      const c = await wa.counts();
      const g = (await wa.contactsInfo()).connected ? await wa.syncContacts().then((x) => ` Google contacts refreshed (${x.contacts} numbers).`, (e) => ` Google contacts failed: ${e?.message ?? e}.`) : '';
      return text(`Pulled ${r.added} new messages in ${(r.ms / 1000).toFixed(1)}s (${r.reason}). Store now holds ${c.messages} messages across ${c.chats} chats.${g}`);
    },
  );

  return server;
}

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  const wa = env.WA.get(env.WA.idFromName('owner'));
  const server = buildServer(wa, new URL(request.url).origin);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}
