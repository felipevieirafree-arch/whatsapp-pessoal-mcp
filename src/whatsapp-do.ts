/**
 * WhatsAppStore - the paired WhatsApp session and message store, one per owner.
 *
 * Pull model: nothing stays connected. pull() opens a Baileys socket, lets
 * WhatsApp deliver whatever it queued for this linked device since we last
 * connected, writes it to SQLite, and hangs up. Pairing is the same session
 * with the QR exposed and a longer leash, so the first full history sync lands.
 */
import './polyfills.js';
import { DurableObject } from 'cloudflare:workers';
import { makeWASocket, DisconnectReason } from '@whiskeysockets/baileys';
import type { WASocket } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-generator';
import { sqliteAuthState } from './auth-state.js';
import { Store, initSchema } from './store.js';
import type { Env } from './index.js';

type Phase = 'idle' | 'connecting' | 'qr' | 'syncing';
export interface SessionResult { reason: string; added: number; ms: number }

const PAIR_MAX_MS = 10 * 60_000;
const PAIR_ABANDON_MS = 3 * 60_000;
const PULL_MAX_MS = 60_000;

const show = (x: unknown): string =>
  x instanceof Error ? `${x.name}: ${x.message}` : typeof x === 'string' ? x : JSON.stringify(x, (_k, v) => (v instanceof Error ? `${v.name}: ${v.message}` : v));

const silent = (sink?: (level: string, args: unknown[]) => void) => {
  const l: any = {
    level: 'warn',
    child: () => l,
    trace() {}, debug() {}, info() {},
    warn: (...a: unknown[]) => sink?.('warn', a),
    error: (...a: unknown[]) => sink?.('error', a),
  };
  return l;
};

export class WhatsAppStore extends DurableObject<Env> {
  private auth: ReturnType<typeof sqliteAuthState>;
  private store: Store;
  private session: Promise<SessionResult> | null = null;
  private phase: Phase = 'idle';
  private qr: string | null = null;
  private pairingCode: string | null = null;
  private lastPoll = 0;
  private sessionAdded = 0;
  private historyProgress: number | null = null;
  private events: string[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    initSchema(ctx.storage.sql);
    this.auth = sqliteAuthState(ctx.storage.sql);
    this.store = new Store(ctx.storage.sql, (fn) => ctx.storage.transactionSync(fn));
  }

  private note(msg: string) {
    this.events.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
    if (this.events.length > 80) this.events.shift();
  }

  // ---------- RPC for the Worker ----------

  isPaired() {
    return this.auth.isPaired();
  }

  /** Everything the pairing page needs, and a heartbeat that keeps the pairing session alive. */
  pairStatus() {
    this.lastPoll = Date.now();
    let qrSvg: string | null = null;
    if (this.qr) {
      const q = qrcode(0, 'M');
      q.addData(this.qr);
      q.make();
      qrSvg = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    }
    return {
      paired: this.auth.isPaired(),
      phase: this.phase,
      running: Boolean(this.session),
      progress: this.historyProgress,
      qrSvg,
      pairingCode: this.pairingCode,
      ...this.store.counts(),
    };
  }

  /** Begin (or continue) a pairing session. Runs in the alarm so it outlives this request. */
  async startPairing() {
    this.lastPoll = Date.now();
    if (!this.session) {
      this.session = this.runSession({ pairing: true, maxMs: PAIR_MAX_MS, idleMs: 8_000 })
        .finally(() => { this.session = null; });
      await this.ctx.storage.setAlarm(Date.now() + 50);
    }
  }

  async requestPairingCode(phone: string) {
    await this.startPairing();
    const digits = phone.replace(/\D/g, '');
    for (let i = 0; i < 40 && !this.sock; i++) await new Promise((r) => setTimeout(r, 250));
    if (!this.sock) throw new Error('socket did not start');
    await new Promise((r) => setTimeout(r, 1500)); // the code request needs the noise handshake done
    this.pairingCode = await this.sock.requestPairingCode(digits);
    return this.pairingCode;
  }

  async alarm() {
    await this.session?.catch(() => {}); // holding the alarm open keeps the DO alive while the session runs
  }

  /** Unlink this device on WhatsApp's side (so it vanishes from the phone's list), then forget the session. Messages stay. */
  async logout() {
    if (this.auth.isPaired()) {
      try {
        await this.unlinkOnServer();
      } catch (e: any) {
        this.note(`server-side unlink failed: ${e?.message}; remove the device in WhatsApp > Linked Devices`);
      }
    }
    this.auth.clear();
    this.ctx.storage.sql.exec(`DELETE FROM meta WHERE k = 'last_pull'`);
  }

  private async unlinkOnServer() {
    const sock = makeWASocket({ auth: this.auth.state, logger: silent(), markOnlineOnConnect: false, getMessage: async () => undefined });
    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timed out connecting')), 20_000);
        sock.ev.on('connection.update', (u) => {
          if (u.connection === 'open') { clearTimeout(t); resolve(); }
          if (u.connection === 'close') { clearTimeout(t); reject(new Error('closed before open')); }
        });
      });
      await sock.logout();
    } finally {
      try { sock.end(undefined); } catch {}
    }
  }

  linkInfo() {
    return { paired: this.auth.isPaired(), lastPull: this.lastPull(), ...this.store.counts() };
  }

  lastPull(): number {
    return Number(this.store.getMeta('last_pull') ?? 0);
  }

  /** Pull anything new from WhatsApp. Safe to call concurrently; callers share one session. */
  async pull(): Promise<SessionResult> {
    if (!this.auth.isPaired()) throw new Error('not paired');
    if (!this.session) {
      this.session = this.runSession({ pairing: false, maxMs: PULL_MAX_MS, idleMs: 4_000 })
        .finally(() => { this.session = null; });
    }
    return this.session;
  }

  /** Pull if the store is older than maxAgeMs. Returns null if it was fresh enough. */
  async pullIfStale(maxAgeMs: number): Promise<SessionResult | null> {
    if (Date.now() - this.lastPull() < maxAgeMs) return null;
    return this.pull();
  }

  debug() {
    return { phase: this.phase, paired: this.auth.isPaired(), lastPull: this.lastPull(), counts: this.store.counts(), events: this.events };
  }

  // ---------- queries (all read-only) ----------

  listChats(query: string | undefined, limit: number) { return this.store.listChats(query, limit); }
  resolveChat(ref: string) { return this.store.resolveChat(ref); }
  getMessages(o: Parameters<Store['getMessages']>[0]) { return this.store.getMessages(o); }
  search(o: Parameters<Store['search']>[0]) { return this.store.search(o); }
  counts() { return this.store.counts(); }
  typeCounts() { return this.ctx.storage.sql.exec(`SELECT type, COUNT(*) n FROM messages GROUP BY type ORDER BY n DESC`).toArray(); }

  // ---------- the session ----------

  private sock: WASocket | null = null;

  private runSession(opts: { pairing: boolean; maxMs: number; idleMs: number }): Promise<SessionResult> {
    const started = Date.now();
    this.sessionAdded = 0;
    this.historyProgress = null;
    this.phase = 'connecting';
    this.qr = null;
    this.pairingCode = null;

    return new Promise<SessionResult>((resolve) => {
      let done = false;
      let lastActivity = Date.now();
      let backlogDelivered = false;
      let restarts = 0;
      const touch = () => { lastActivity = Date.now(); };

      const finish = async (reason: string) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        try { this.sock?.end(undefined); } catch {}
        this.sock = null;
        this.phase = 'idle';
        this.qr = null;
        this.pairingCode = null;
        if (this.auth.isPaired() && reason !== 'logged_out') this.store.setMeta('last_pull', String(Date.now()));
        this.note(`session end: ${reason}, +${this.sessionAdded} messages`);
        resolve({ reason, added: this.sessionAdded, ms: Date.now() - started });
      };

      const connect = () => {
        try { open(); } catch (e: any) { this.note(`connect error: ${e?.stack ?? e}`.slice(0, 600)); void finish('error'); }
      };
      const open = () => {
        const sock = makeWASocket({
          auth: this.auth.state,
          logger: silent((lvl, a) => this.note(`${lvl}: ${a.map(show).join(' ').slice(0, 300)}`)),
          syncFullHistory: true,
          markOnlineOnConnect: false, // stay invisible so the phone keeps notifying
          generateHighQualityLinkPreview: false,
          getMessage: async () => undefined,
        });
        this.sock = sock;

        sock.ev.process(async (ev) => {
          if (ev['messaging-history.set'] || ev['messages.upsert']) touch();
          try {
            if (ev['creds.update']) await this.auth.saveCreds();

            if (ev['connection.update']) {
              const u = ev['connection.update'];
              if (u.qr) { this.qr = u.qr; this.phase = 'qr'; this.note('qr'); }
              if (u.receivedPendingNotifications) { backlogDelivered = true; this.note('backlog delivered'); }
              if (u.connection === 'open') {
                this.qr = null;
                this.phase = 'syncing';
                this.note('open');
                // group names only come from an explicit fetch
                sock.groupFetchAllParticipating()
                  .then((g) => this.store.upsertChatNames(Object.values(g)))
                  .catch((e) => this.note(`groups: ${e?.message}`));
              }
              if (u.connection === 'close') {
                const code = (u.lastDisconnect?.error as any)?.output?.statusCode;
                this.note(`close ${code}`);
                if (code === DisconnectReason.loggedOut) {
                  this.auth.clear();
                  await finish('logged_out');
                } else if (code === DisconnectReason.connectionReplaced) {
                  await finish('replaced');
                } else if (!done && restarts++ < 8) {
                  // 515 restartRequired follows every successful pairing; reconnect with the new creds
                  this.sock = null;
                  connect();
                } else {
                  await finish(`closed_${code}`);
                }
              }
            }

            if (ev['messaging-history.set']) {
              const h = ev['messaging-history.set'];
              for (const m of h.lidPnMappings ?? []) this.store.addAlias(m.lid, m.pn);
              this.store.upsertContacts(h.contacts ?? []);
              this.store.upsertChatNames(h.chats ?? []);
              this.sessionAdded += this.store.ingestMessages(h.messages ?? []);
              if (typeof h.progress === 'number') this.historyProgress = h.progress;
              this.note(`history chunk: ${h.messages?.length ?? 0} msgs, progress ${h.progress ?? '-'}`);
            }
            if (ev['messages.upsert']) this.sessionAdded += this.store.ingestMessages(ev['messages.upsert'].messages);
            if (ev['lid-mapping.update']) this.store.addAlias(ev['lid-mapping.update'].lid, ev['lid-mapping.update'].pn);
            if (ev['contacts.upsert']) this.store.upsertContacts(ev['contacts.upsert']);
            if (ev['contacts.update']) this.store.upsertContacts(ev['contacts.update'] as any);
            if (ev['chats.upsert']) this.store.upsertChatNames(ev['chats.upsert']);
            if (ev['chats.update']) this.store.upsertChatNames(ev['chats.update'] as any);
            if (ev['groups.upsert']) this.store.upsertChatNames(ev['groups.upsert']);
            if (ev['groups.update']) this.store.upsertChatNames(ev['groups.update'] as any);
          } catch (e: any) {
            this.note(`handler error: ${e?.message}`);
          }
        });
      };

      const timer = setInterval(() => {
        const now = Date.now();
        if (now - started > opts.maxMs) return void finish('max_time');
        const paired = this.auth.isPaired();
        if (opts.pairing && !paired && now - this.lastPoll > PAIR_ABANDON_MS) return void finish('abandoned');
        if (!paired) return; // waiting on a scan
        // a first link waits for WhatsApp's own "100%"; a plain pull just waits for quiet
        const historyDone = !opts.pairing || this.historyProgress === 100;
        if (backlogDelivered && historyDone && now - lastActivity > opts.idleMs) void finish('idle');
      }, 1000);

      connect();
    });
  }
}
