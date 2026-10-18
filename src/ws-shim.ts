/**
 * Stand-in for the `ws` package, which needs node:net/tls. Baileys only uses a
 * small slice of it: construct with { origin, headers }, on/once/off, send, close,
 * readyState. Workers can't set Origin via `new WebSocket`, but fetch() with an
 * Upgrade header can, and WhatsApp's server checks it.
 */
import { EventEmitter } from 'node:events';

export default class WebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  private ws: globalThis.WebSocket | null = null;

  constructor(url: string | URL, opts: { origin?: string; headers?: Record<string, string> } = {}) {
    super();
    const headers: Record<string, string> = { Upgrade: 'websocket', ...opts.headers };
    if (opts.origin) headers.Origin = opts.origin;
    fetch(String(url).replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'), { headers })
      .then((res) => {
        const ws = (res as unknown as { webSocket: globalThis.WebSocket | null }).webSocket;
        if (!ws) throw new Error(`websocket upgrade refused (${res.status})`);
        ws.accept();
        this.ws = ws;
        ws.addEventListener('message', (e) => {
          const d = e.data as string | ArrayBuffer;
          this.emit('message', typeof d === 'string' ? Buffer.from(d) : Buffer.from(d), typeof d === 'string');
        });
        ws.addEventListener('close', () => {
          this.readyState = 3;
          this.emit('close', 1000, Buffer.alloc(0));
        });
        ws.addEventListener('error', () => this.emit('error', new Error('websocket error')));
        this.readyState = 1;
        this.emit('open');
      })
      .catch((err) => {
        this.readyState = 3;
        this.emit('error', err);
        this.emit('close', 1006, Buffer.alloc(0));
      });
  }

  send(data: Uint8Array | string, cb?: (err?: Error) => void) {
    try {
      this.ws!.send(data);
      cb?.();
    } catch (err) {
      cb?.(err as Error);
    }
  }

  close() {
    this.readyState = 2;
    try {
      this.ws?.close(1000);
    } catch {}
    if (!this.ws) {
      this.readyState = 3;
      this.emit('close', 1000, Buffer.alloc(0));
    }
  }

  terminate() {
    this.close();
  }
}
