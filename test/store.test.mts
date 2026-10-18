// Runs the real Store against node:sqlite (a stand-in for the Durable Object's SqlStorage).
import { DatabaseSync } from 'node:sqlite';
import { initSchema, Store } from '../src/store.ts';

const db = new DatabaseSync(':memory:');
const sql: any = {
  exec(q: string, ...args: any[]) {
    const stmt = db.prepare(q);
    const isRead = /^\s*(select|with|pragma)/i.test(q);
    if (isRead) {
      const rows = stmt.all(...args) as any[];
      return { toArray: () => rows, one: () => rows[0], rowsWritten: 0 };
    }
    // multi-statement scripts (the schema) go through exec
    if (args.length === 0 && q.trim().split(';').filter((x) => x.trim()).length > 1) {
      q = q.replace(/CREATE VIRTUAL TABLE[^;]*;/g, '').replace(/CREATE TRIGGER[\s\S]*?END;/g, '');
      db.exec(q); return { toArray: () => [], one: () => undefined, rowsWritten: 0 }; }
    const r = stmt.run(...args);
    return { toArray: () => [], one: () => undefined, rowsWritten: Number(r.changes) };
  },
};
// Simulate the previous deployment: a google_contacts table and a stored refresh token.
db.exec(`CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT); INSERT INTO meta VALUES ('google_refresh','secret-token'),('last_pull','123');
         CREATE TABLE google_contacts (jid TEXT PRIMARY KEY, name TEXT NOT NULL); INSERT INTO google_contacts VALUES ('972524219320@s.whatsapp.net','Gilad Shoham');`);
initSchema(sql);
const store = new Store(sql, (fn) => fn());

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' -> ' + JSON.stringify(detail)}`); if (!ok) failed++; };

// migration
check('old Google names kept under custom_names', (db.prepare(`SELECT name FROM custom_names WHERE jid='972524219320@s.whatsapp.net'`).get() as any)?.name === 'Gilad Shoham');
check('old google_contacts table gone', !db.prepare(`SELECT 1 FROM sqlite_master WHERE name='google_contacts'`).get());
check('stored Google credential deleted', !db.prepare(`SELECT 1 FROM meta WHERE k='google_refresh'`).get());
check('other meta kept', (db.prepare(`SELECT v FROM meta WHERE k='last_pull'`).get() as any)?.v === '123');

// seed: Gilad's chat has WhatsApp's masked placeholder as its contact name, and one stranger with no name at all
const M = (id: string, chat: string, ts: number, body: string, fromMe = false) =>
  ({ key: { id, remoteJid: chat, fromMe }, messageTimestamp: ts, message: { conversation: body }, pushName: undefined }) as any;
store.ingestMessages([M('a1', '972524219320@s.whatsapp.net', 100, 'hi'), M('a2', '972524219320@s.whatsapp.net', 200, 'shalom, got a minute?'),
                      M('b1', '972500000001@s.whatsapp.net', 150, 'wrong number, sorry'),
                      M('c1', '972500000002@s.whatsapp.net', 160, 'hello', true), M('c2', '972500000002@s.whatsapp.net', 170, 'hey there')]);
db.exec(`INSERT INTO contacts (jid, name) VALUES ('972524219320@s.whatsapp.net', '+972∙∙∙∙∙∙∙20')`);
store.upsertChatNames([{ id: '972500000001@s.whatsapp.net', name: '+972∙∙∙∙∙∙∙01' }]);   // placeholders must not be stored
check('placeholder chat name not stored', !db.prepare(`SELECT 1 FROM chats WHERE jid='972500000001@s.whatsapp.net' AND name IS NOT NULL`).get());

const names = (store.listChats(undefined, 10) as any[]).map((r) => `${r.jid.slice(0, 12)}=${r.name}`);
check('Gilad shows his saved name, not the placeholder', (store.listChats('Gilad', 5) as any[]).length === 1, names);
check('searching by his name resolves the chat', (store.resolveChat('gilad') as any[])[0]?.jid === '972524219320@s.whatsapp.net');

// unnamed_chats
const un = store.unnamedChats(10) as any[];
check('unnamed chats lists the strangers, not Gilad', un.length === 2 && !un.some((r) => r.jid.startsWith('9725242')), un.map((r) => r.jid));
check('busiest unnamed chat comes first', un[0]?.jid === '972500000002@s.whatsapp.net', un.map((r) => r.messages));
check('last thing THEY said, not me', un[0]?.last_theirs === 'hey there', un[0]);
check('unnamed count', store.unnamedCount() === 2);

// set_contact_names
const r1 = store.setCustomNames([{ jid: '972500000002@s.whatsapp.net', name: 'Dana Levi' }, { jid: '972599999999@s.whatsapp.net', name: 'Nobody Yet' }]);
check('save reports saved and which have chats', r1.saved === 2 && r1.withChat === 1, r1);
check('named chat leaves the unnamed list', store.unnamedCount() === 1);
check('new name shows in chat list', (store.listChats('Dana', 5) as any[]).length === 1);
const msgs = store.getMessages({ chat: '972500000002@s.whatsapp.net', limit: 5 }) as any[];
check('sender name used in messages', msgs.some((m) => m.sender === 'Dana Levi'), msgs.map((m) => m.sender));
const r2 = store.setCustomNames([{ jid: '972500000002@s.whatsapp.net', name: '' }]);
check('empty name removes it', r2.removed === 1 && store.unnamedCount() === 2, r2);

// search still works and shows custom names for senders in groups
store.ingestMessages([{ key: { id: 'g1', remoteJid: '1203@g.us', fromMe: false, participant: '972524219320@s.whatsapp.net' }, messageTimestamp: 300, message: { conversation: 'lunch at noon' } } as any]);
const gm = store.getMessages({ chat: '1203@g.us', limit: 5 }) as any[];
check('group message sender resolves to custom name', gm[0]?.sender === 'Gilad Shoham', gm);

// phone parsing
const { toJid } = await import('../src/phone.ts');
const cases: [string, string | undefined, string | null][] = [
  ['+972 52-421-9320', undefined, '972524219320@s.whatsapp.net'], ['052-421-9320', '972', '972524219320@s.whatsapp.net'],
  ['052-421-9320', undefined, null], ['00972524219320', undefined, '972524219320@s.whatsapp.net'],
  ['524219320', '972', '972524219320@s.whatsapp.net'], ['972524219320@s.whatsapp.net', undefined, '972524219320@s.whatsapp.net'],
  ['abc', '972', null], ['+1 (818) 917-7834', '972', '18189177834@s.whatsapp.net'],
];
for (const [i, cc, want] of cases) check(`toJid(${JSON.stringify(i)}, ${cc})`, toJid(i, cc) === want, toJid(i, cc));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
