/**
 * Counts how many accounts exist, so signups can be capped. One object for the whole service, because a
 * counter that two signups can read at once is not a cap. Deleting an account gives its seat back.
 */
import { DurableObject } from 'cloudflare:workers';

export class Registry extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS seats (k TEXT PRIMARY KEY, n INTEGER NOT NULL)`);
  }

  count(): number {
    return this.ctx.storage.sql.exec<{ n: number }>(`SELECT n FROM seats WHERE k = 'taken'`).toArray()[0]?.n ?? 0;
  }

  /** Take a seat. `limit` 0 means no cap, but the seat is still counted. */
  claim(limit: number): { ok: boolean; count: number } {
    const n = this.count();
    if (limit > 0 && n >= limit) return { ok: false, count: n };
    this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO seats (k, n) VALUES ('taken', ?)`, n + 1);
    return { ok: true, count: n + 1 };
  }

  release(): number {
    const n = Math.max(0, this.count() - 1);
    this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO seats (k, n) VALUES ('taken', ?)`, n);
    return n;
  }
}
