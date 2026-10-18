/** Baileys auth state backed by the Durable Object's SQLite, replacing useMultiFileAuthState. */
import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys';
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys';

export function sqliteAuthState(sql: SqlStorage) {
  sql.exec(`CREATE TABLE IF NOT EXISTS auth (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);

  const read = (k: string) => {
    const row = sql.exec<{ v: string }>(`SELECT v FROM auth WHERE k = ?`, k).toArray()[0];
    return row ? JSON.parse(row.v, BufferJSON.reviver) : null;
  };
  const write = (k: string, value: unknown) =>
    sql.exec(`INSERT OR REPLACE INTO auth (k, v) VALUES (?, ?)`, k, JSON.stringify(value, BufferJSON.replacer));
  const remove = (k: string) => sql.exec(`DELETE FROM auth WHERE k = ?`, k);

  const creds: AuthenticationCreds = read('creds') ?? initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const out: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const id of ids) {
          let value = read(`${type}-${id}`);
          if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
          if (value) out[id] = value;
        }
        return out;
      },
      set: async (data) => {
        for (const [type, entries] of Object.entries(data)) {
          for (const [id, value] of Object.entries(entries ?? {})) {
            if (value) write(`${type}-${id}`, value);
            else remove(`${type}-${id}`);
          }
        }
      },
    },
  };

  return {
    state,
    saveCreds: async () => write('creds', creds),
    clear: () => {
      sql.exec(`DELETE FROM auth`);
      // Baileys holds this object; reset it in place so a fresh pairing starts clean
      for (const k of Object.keys(creds)) delete (creds as any)[k];
      Object.assign(creds, initAuthCreds());
    },
    // QR pairing never sets `registered` (that's the mobile flow); `me` is the signal
    isPaired: () => Boolean(creds.me?.id),
  };
}
