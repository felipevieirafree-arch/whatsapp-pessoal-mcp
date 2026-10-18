/** Message store: schema, ingest from Baileys events, and the queries the MCP tools use. */
import { getContentType, normalizeMessageContent, jidNormalizedUser } from '@whiskeysockets/baileys';
import type { proto } from '@whiskeysockets/baileys';

export function initSchema(sql: SqlStorage) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT NOT NULL, chat TEXT NOT NULL, ts INTEGER NOT NULL, from_me INTEGER NOT NULL,
      sender TEXT, push_name TEXT, type TEXT NOT NULL, body TEXT NOT NULL,
      PRIMARY KEY (chat, id)
    );
    CREATE INDEX IF NOT EXISTS messages_chat_ts ON messages (chat, ts);
    CREATE INDEX IF NOT EXISTS messages_ts ON messages (ts);
    CREATE TABLE IF NOT EXISTS chats (jid TEXT PRIMARY KEY, name TEXT, is_group INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS contacts (jid TEXT PRIMARY KEY, name TEXT, notify TEXT);
    CREATE TABLE IF NOT EXISTS google_contacts (jid TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS alias (lid TEXT PRIMARY KEY, pn TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(body, content='messages', content_rowid='rowid');
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF body ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
      INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
    END;
  `);
}

/** WhatsApp names chats it has no contact for after the number, sometimes masked ("+972∙∙∙∙∙∙∙20"). That is a placeholder, not a name. */
const numberLike = (x: string) => `(${x} LIKE '%∙%' OR trim(replace(replace(replace(${x}, '+', ''), ' ', ''), '-', ''), '0123456789') = '')`;
const realName = (x: string) => `(CASE WHEN ${x} IS NULL OR ${numberLike(x)} THEN NULL ELSE ${x} END)`;

/** The same test in JS, so placeholders never get stored. */
const isPlaceholder = (name?: string | null) => !name || /∙/.test(name) || /^[\d\s+-]*$/.test(name);
const num = (v: unknown) => Number((v as { toNumber?: () => number })?.toNumber?.() ?? v ?? 0);

/** What a message says, in text. Media becomes a short label so search and reading still make sense. */
export function describe(msg: proto.IWebMessageInfo): { type: string; body: string } | null {
  const m = normalizeMessageContent(msg.message);
  if (!m) return null;
  const type = getContentType(m);
  if (!type) return null;
  const cap = (s?: string | null) => (s ? ` ${s}` : '');
  switch (type) {
    case 'conversation':
      return { type: 'text', body: m.conversation ?? '' };
    case 'extendedTextMessage':
      return { type: 'text', body: m.extendedTextMessage?.text ?? '' };
    case 'imageMessage':
      return { type: 'image', body: `[image]${cap(m.imageMessage?.caption)}` };
    case 'videoMessage':
      return { type: 'video', body: `[video]${cap(m.videoMessage?.caption)}` };
    case 'audioMessage': {
      const s = num(m.audioMessage?.seconds);
      return { type: 'audio', body: `[${m.audioMessage?.ptt ? 'voice note' : 'audio'}${s ? ` ${s}s` : ''}]` };
    }
    case 'documentMessage':
      return { type: 'document', body: `[document: ${m.documentMessage?.fileName ?? 'file'}]${cap(m.documentMessage?.caption)}` };
    case 'documentWithCaptionMessage':
      return { type: 'document', body: `[document]` };
    case 'stickerMessage':
      return { type: 'sticker', body: '[sticker]' };
    case 'locationMessage':
    case 'liveLocationMessage':
      return { type: 'location', body: `[location${m.locationMessage?.name ? `: ${m.locationMessage.name}` : ''}]` };
    case 'contactMessage':
      return { type: 'contact', body: `[contact: ${m.contactMessage?.displayName ?? ''}]` };
    case 'pollCreationMessage':
    case 'pollCreationMessageV2':
    case 'pollCreationMessageV3':
      return { type: 'poll', body: `[poll: ${(m as any)[type]?.name ?? ''}]` };
    default:
      return null; // reactions, protocol, key distribution and other plumbing
  }
}

export class Store {
  constructor(private sql: SqlStorage, private tx: <T>(fn: () => T) => T) {}

  private norm(jid?: string | null, alt?: string | null): string | null {
    if (!jid) return null;
    if (jid.endsWith('@lid')) {
      if (alt && !alt.endsWith('@lid')) {
        this.addAlias(jid, alt);
        return jidNormalizedUser(alt);
      }
      const row = this.sql.exec<{ pn: string }>(`SELECT pn FROM alias WHERE lid = ?`, jidNormalizedUser(jid)).toArray()[0];
      if (row) return row.pn;
    }
    return jidNormalizedUser(jid);
  }

  addAlias(lid: string, pn: string) {
    lid = jidNormalizedUser(lid);
    pn = jidNormalizedUser(pn);
    this.sql.exec(`INSERT OR REPLACE INTO alias (lid, pn) VALUES (?, ?)`, lid, pn);
    // fold anything already stored under the lid into the phone-number jid
    for (const table of ['messages'] as const) {
      this.sql.exec(`UPDATE OR IGNORE ${table} SET chat = ? WHERE chat = ?`, pn, lid);
      this.sql.exec(`UPDATE ${table} SET sender = ? WHERE sender = ?`, pn, lid);
    }
    this.sql.exec(`DELETE FROM messages WHERE chat = ?`, lid);
    this.sql.exec(`INSERT OR IGNORE INTO chats (jid, name, is_group) SELECT ?, name, 0 FROM chats WHERE jid = ?`, pn, lid);
    this.sql.exec(`DELETE FROM chats WHERE jid = ?`, lid);
  }

  /** Inserts new messages and applies edits/deletes. Returns how many were new. */
  ingestMessages(msgs: proto.IWebMessageInfo[]): number {
    const total = () => this.sql.exec<{ n: number }>(`SELECT COUNT(*) n FROM messages`).one().n;
    const before = total();
    this.tx(() => {
      for (const msg of msgs) {
        const key = msg.key;
        if (!key?.id || !key.remoteJid || key.remoteJid === 'status@broadcast') continue;
        const chat = this.norm(key.remoteJid, (key as any).remoteJidAlt);
        if (!chat) continue;
        const proto_ = msg.message?.protocolMessage;
        if (proto_?.key?.id) {
          if (proto_.editedMessage) {
            const body = proto_.editedMessage.conversation ?? proto_.editedMessage.extendedTextMessage?.text;
            if (body) this.sql.exec(`UPDATE messages SET body = ? WHERE chat = ? AND id = ?`, body, chat, proto_.key.id);
          } else if (proto_.type === 0) {
            this.sql.exec(`UPDATE messages SET body = '[deleted]', type = 'deleted' WHERE chat = ? AND id = ?`, chat, proto_.key.id);
          }
          continue;
        }
        const d = describe(msg);
        if (!d) continue;
        const isGroup = chat.endsWith('@g.us');
        const sender = key.fromMe
          ? 'me'
          : isGroup
            ? this.norm(key.participant ?? msg.participant, (key as any).participantAlt)
            : chat;
        this.sql.exec(
          `INSERT INTO messages (id, chat, ts, from_me, sender, push_name, type, body) VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(chat, id) DO UPDATE SET sender = COALESCE(sender, excluded.sender), push_name = COALESCE(push_name, excluded.push_name)
           WHERE sender IS NULL OR push_name IS NULL`,
          key.id, chat, num(msg.messageTimestamp), key.fromMe ? 1 : 0, sender, msg.pushName ?? null, d.type, d.body,
        );
        this.sql.exec(`INSERT OR IGNORE INTO chats (jid, is_group) VALUES (?, ?)`, chat, isGroup ? 1 : 0);
      }
    });
    return total() - before; // upserts that only fill in a sender don't count as new
  }

  upsertContacts(contacts: { id?: string | null; lid?: string | null; phoneNumber?: string | null; name?: string | null; notify?: string | null; verifiedName?: string | null }[]) {
    this.tx(() => {
      for (const c of contacts) {
        if (!c.id) continue;
        const pn = c.id.endsWith('@lid') ? c.phoneNumber : c.id;
        const lid = c.id.endsWith('@lid') ? c.id : c.lid;
        if (lid && pn) this.addAlias(lid, pn);
        const jid = jidNormalizedUser(pn || c.id);
        this.sql.exec(
          `INSERT INTO contacts (jid, name, notify) VALUES (?,?,?)
           ON CONFLICT(jid) DO UPDATE SET name = COALESCE(excluded.name, name), notify = COALESCE(excluded.notify, notify)`,
          jid, isPlaceholder(c.name) ? null : c.name, isPlaceholder(c.notify ?? c.verifiedName) ? null : (c.notify ?? c.verifiedName),
        );
      }
    });
  }

  upsertChatNames(chats: { id?: string | null; name?: string | null; subject?: string | null }[]) {
    this.tx(() => {
      for (const c of chats) {
        const name = c.name ?? c.subject;
        if (!c.id || !name || isPlaceholder(name)) continue;
        const jid = this.norm(c.id) ?? c.id;
        this.sql.exec(
          `INSERT INTO chats (jid, name, is_group) VALUES (?,?,?) ON CONFLICT(jid) DO UPDATE SET name = excluded.name`,
          jid, name, jid.endsWith('@g.us') ? 1 : 0,
        );
      }
    });
  }

  /** Replace the whole Google contacts snapshot. Keyed by WhatsApp jid, so matching is by phone number. */
  replaceGoogleContacts(rows: { jid: string; name: string }[]) {
    this.tx(() => {
      this.sql.exec(`DELETE FROM google_contacts`);
      for (const r of rows) this.sql.exec(`INSERT OR IGNORE INTO google_contacts (jid, name) VALUES (?, ?)`, r.jid, r.name);
    });
  }
  googleContactCount(): number {
    return this.sql.exec<{ n: number }>(`SELECT COUNT(*) n FROM google_contacts`).one().n;
  }
  /** Chats that now have a name only because of Google, for a sense of how much it helped. */
  namedByGoogle(): number {
    return this.sql
      .exec<{ n: number }>(
        `SELECT COUNT(*) n FROM chats c JOIN google_contacts gc ON gc.jid = c.jid
         LEFT JOIN contacts ct ON ct.jid = c.jid
         WHERE c.is_group = 0 AND (c.name IS NULL OR ${numberLike('c.name')}) AND (ct.name IS NULL OR ${numberLike('ct.name')}) AND EXISTS (SELECT 1 FROM messages m WHERE m.chat = c.jid)`,
      )
      .one().n;
  }

  setMeta(k: string, v: string) {
    this.sql.exec(`INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)`, k, v);
  }
  getMeta(k: string): string | null {
    return this.sql.exec<{ v: string }>(`SELECT v FROM meta WHERE k = ?`, k).toArray()[0]?.v ?? null;
  }

  counts() {
    const one = <T>(q: string) => this.sql.exec<T & Record<string, number>>(q).toArray()[0];
    return {
      messages: one<{ n: number }>(`SELECT COUNT(*) n FROM messages`).n,
      chats: one<{ n: number }>(`SELECT COUNT(DISTINCT chat) n FROM messages`).n,
    };
  }

  // ---------- queries ----------

  private nameExpr = `COALESCE(${realName('ch.name')}, ${realName('ct.name')}, gc.name, ${realName('ct.notify')},
      (SELECT push_name FROM messages p WHERE p.chat = c.jid AND p.from_me = 0 AND p.push_name IS NOT NULL ORDER BY p.ts DESC LIMIT 1),
      CASE WHEN c.jid LIKE '%@s.whatsapp.net' THEN '+' || replace(c.jid, '@s.whatsapp.net', '') ELSE c.jid END)`;

  /** Resolve a chat reference (jid, or name/number fragment) to jids. */
  resolveChat(ref: string): { jid: string; name: string }[] {
    if (ref.includes('@')) return [{ jid: ref, name: this.chatName(ref) }];
    const like = `%${ref.replace(/[%_]/g, '')}%`;
    return this.sql
      .exec<{ jid: string; name: string }>(
        `SELECT c.jid, ${this.nameExpr} AS name FROM chats c
         LEFT JOIN chats ch ON ch.jid = c.jid LEFT JOIN contacts ct ON ct.jid = c.jid LEFT JOIN google_contacts gc ON gc.jid = c.jid
         WHERE EXISTS (SELECT 1 FROM messages m WHERE m.chat = c.jid)
           AND (${this.nameExpr} LIKE ? OR c.jid LIKE ?)
         ORDER BY (SELECT MAX(ts) FROM messages m WHERE m.chat = c.jid) DESC LIMIT 10`,
        like, like,
      )
      .toArray();
  }

  chatName(jid: string): string {
    return (
      this.sql
        .exec<{ name: string }>(
          `SELECT ${this.nameExpr} AS name FROM (SELECT ? AS jid) c
           LEFT JOIN chats ch ON ch.jid = c.jid LEFT JOIN contacts ct ON ct.jid = c.jid LEFT JOIN google_contacts gc ON gc.jid = c.jid`,
          jid,
        )
        .toArray()[0]?.name ?? jid
    );
  }

  listChats(query: string | undefined, limit: number) {
    const like = query ? `%${query.replace(/[%_]/g, '')}%` : '%';
    return this.sql
      .exec(
        `SELECT * FROM (
           SELECT c.jid AS jid, ${this.nameExpr} AS name, c.is_group AS is_group,
                  (SELECT COUNT(*) FROM messages m WHERE m.chat = c.jid) AS messages,
                  (SELECT MAX(ts) FROM messages m WHERE m.chat = c.jid) AS last_ts
           FROM chats c LEFT JOIN chats ch ON ch.jid = c.jid LEFT JOIN contacts ct ON ct.jid = c.jid LEFT JOIN google_contacts gc ON gc.jid = c.jid
         ) WHERE messages > 0 AND (name LIKE ? OR jid LIKE ?)
         ORDER BY last_ts DESC LIMIT ?`,
        like, like, limit,
      )
      .toArray();
  }

  private senderName = `CASE WHEN m.from_me = 1 THEN 'Me' ELSE COALESCE(${realName('ct.name')}, gc.name, ${realName('ct.notify')}, m.push_name, '+' || replace(replace(m.sender, '@s.whatsapp.net', ''), '@lid', ''), 'unknown') END`;

  getMessages(opts: { chat: string; before?: number; after?: number; limit: number; newestFirst?: boolean }) {
    const where = [`m.chat = ?`];
    const args: (string | number)[] = [opts.chat];
    if (opts.before) { where.push(`m.ts < ?`); args.push(opts.before); }
    if (opts.after) { where.push(`m.ts > ?`); args.push(opts.after); }
    // newest N, shown oldest-first, unless an `after` cursor asks to page forward
    const order = opts.after && !opts.before ? 'ASC' : 'DESC';
    const rows = this.sql
      .exec(
        `SELECT m.id, m.ts, ${this.senderName} AS sender, m.type, m.body
         FROM messages m LEFT JOIN contacts ct ON ct.jid = m.sender LEFT JOIN google_contacts gc ON gc.jid = m.sender
         WHERE ${where.join(' AND ')} ORDER BY m.ts ${order} LIMIT ?`,
        ...args, opts.limit,
      )
      .toArray();
    return order === 'DESC' ? rows.reverse() : rows;
  }

  search(opts: { query: string; chat?: string; since?: number; until?: number; limit: number }) {
    const where = [`messages_fts MATCH ?`];
    const args: (string | number)[] = [ftsQuery(opts.query)];
    if (opts.chat) { where.push(`m.chat = ?`); args.push(opts.chat); }
    if (opts.since) { where.push(`m.ts >= ?`); args.push(opts.since); }
    if (opts.until) { where.push(`m.ts <= ?`); args.push(opts.until); }
    return this.sql
      .exec(
        `SELECT m.id, m.chat, m.ts, ${this.senderName} AS sender, m.body,
                (SELECT COALESCE(${realName('ch.name')}, ${realName('ct2.name')}, gc2.name, ${realName('ct2.notify')}, m.chat) FROM (SELECT m.chat AS jid) x
                  LEFT JOIN chats ch ON ch.jid = x.jid LEFT JOIN contacts ct2 ON ct2.jid = x.jid LEFT JOIN google_contacts gc2 ON gc2.jid = x.jid) AS chat_name
         FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
         LEFT JOIN contacts ct ON ct.jid = m.sender LEFT JOIN google_contacts gc ON gc.jid = m.sender
         WHERE ${where.join(' AND ')} ORDER BY m.ts DESC LIMIT ?`,
        ...args, opts.limit,
      )
      .toArray();
  }
}

/** Plain words become AND-ed quoted terms; quoted phrases pass through. Keeps FTS5 syntax errors away from the agent. */
function ftsQuery(q: string): string {
  const terms = q.match(/"[^"]+"|\S+/g) ?? [];
  return terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' ');
}
