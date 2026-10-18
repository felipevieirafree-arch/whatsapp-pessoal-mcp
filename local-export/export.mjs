/**
 * One-off export: link as a WhatsApp device, wait for the history sync, write one JSON file per chat.
 * No server, no Cloudflare. Run it from this folder:
 *
 *   npm install && node export.mjs            # every chat
 *   node export.mjs --out ./dump --min 5      # custom folder, skip chats under 5 messages
 *
 * The session is kept in ./auth so a second run doesn't need the QR code. Both ./auth and the output
 * are private: auth is a live login to your WhatsApp account, and the export is your messages.
 */
import { makeWASocket, useMultiFileAuthState, DisconnectReason, getContentType, normalizeMessageContent } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const outDir = flag('--out', 'exports');
const minMessages = Number(flag('--min', 1));
const IDLE_MS = 30_000; // history is done when nothing new has arrived for this long

const quiet = { level: 'silent', child: () => quiet, trace() {}, debug() {}, info() {}, warn() {}, error() {} };
const chats = new Map(); // jid -> { name, messages: [] }
const names = new Map(); // jid -> contact name
let total = 0;
let lastActivity = Date.now();

const chatOf = (jid) => chats.get(jid) ?? chats.set(jid, { name: null, messages: [] }).get(jid);

function textOf(msg) {
  const m = normalizeMessageContent(msg.message);
  const type = m && getContentType(m);
  if (!type) return null;
  if (type === 'conversation') return { type: 'text', body: m.conversation };
  if (type === 'extendedTextMessage') return { type: 'text', body: m.extendedTextMessage.text };
  const media = { imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio', documentMessage: 'document', stickerMessage: 'sticker' }[type];
  if (media) return { type: media, body: `[${media}]${m[type].caption ? ` ${m[type].caption}` : ''}` };
  return null; // reactions, protocol messages and other plumbing
}

function add(msg) {
  const jid = msg.key?.remoteJid;
  if (!jid || jid === 'status@broadcast') return;
  const t = textOf(msg);
  if (!t) return;
  chatOf(jid).messages.push({
    timestamp: Number(msg.messageTimestamp ?? 0),
    fromMe: Boolean(msg.key.fromMe),
    sender: msg.key.fromMe ? 'me' : msg.key.participant ?? msg.participant ?? jid,
    pushName: msg.pushName ?? '',
    ...t,
  });
  total++;
  lastActivity = Date.now();
}

async function run() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const sock = makeWASocket({ auth: state, syncFullHistory: true, markOnlineOnConnect: false, logger: quiet });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messaging-history.set', ({ messages, chats: cs, contacts }) => {
    (messages ?? []).forEach(add);
    (cs ?? []).forEach((c) => c.name && (chatOf(c.id).name = c.name));
    (contacts ?? []).forEach((c) => (c.name || c.notify) && names.set(c.id, c.name || c.notify));
    process.stdout.write(`\r${total} messages in ${chats.size} chats...`);
  });
  sock.ev.on('messages.upsert', ({ messages }) => messages.forEach(add));
  sock.ev.on('contacts.upsert', (cs) => cs.forEach((c) => (c.name || c.notify) && names.set(c.id, c.name || c.notify)));

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\nScan with WhatsApp: Settings > Linked Devices > Link a Device\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      console.log('Connected. Waiting for history...');
      lastActivity = Date.now();
      const timer = setInterval(() => {
        if (total > 0 && Date.now() - lastActivity > IDLE_MS) {
          clearInterval(timer);
          save();
        }
      }, 2000);
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) return console.log('Logged out. Delete ./auth and run again.');
      run(); // 515 after the first scan means "restart with the new credentials"
    }
  });
}

function save() {
  mkdirSync(outDir, { recursive: true });
  let written = 0;
  for (const [jid, chat] of chats) {
    if (chat.messages.length < minMessages) continue;
    chat.messages.sort((a, b) => a.timestamp - b.timestamp);
    const name = chat.name ?? names.get(jid) ?? chat.messages.find((m) => m.pushName)?.pushName ?? jid;
    // file names come from the jid, so Hebrew or emoji chat names can't collide or break the filesystem
    writeFileSync(`${outDir}/${jid.replace(/[^\w.-]/g, '_')}.json`, JSON.stringify({ jid, name, messages: chat.messages }, null, 2));
    written++;
  }
  console.log(`\nWrote ${written} chats (${total} messages) to ${outDir}/`);
  process.exit(0);
}

run();
