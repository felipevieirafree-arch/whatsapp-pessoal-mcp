/** The front page: what this is, and the two steps to use it. Nothing private on it, since anyone can load it. */

import { baseCss, copyScript, esc } from './ui.js';

const REPO = 'https://github.com/finereli/whatsapp-mcp';

export function landingPage(origin: string): string {
  const mcp = `${origin}/mcp`;
  const command = `claude mcp add --transport http whatsapp ${mcp}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp for your agent</title>
<meta name="description" content="A read-only MCP server that lets your AI agent search and read your own WhatsApp messages. Runs in your Cloudflare account.">
<style>
${baseCss}
main { padding-top: 64px; }
h1 { font-size: clamp(2.1rem, 7vw, 3rem); }
.lede { font-size: 1.12rem; }

.chat { margin: 36px 0 44px; display: grid; gap: 10px; }
.bubble { max-width: 82%; padding: 10px 14px; border-radius: 16px; line-height: 1.45; }
.bubble.me { justify-self: end; background: var(--mine); border-bottom-right-radius: 4px; }
.bubble.agent { justify-self: start; background: var(--theirs); border-bottom-left-radius: 4px; border: 1px solid var(--rule); }
.call { justify-self: start; margin: 0 0 0 6px; color: var(--muted); font: 0.84rem/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }

.steps { list-style: none; padding: 0; margin: 0; display: grid; gap: 30px; counter-reset: step; }
.steps > li { counter-increment: step; padding-left: 44px; position: relative; }
.steps > li::before { content: counter(step); position: absolute; left: 0; top: 1px; width: 28px; height: 28px; border-radius: 50%; border: 1.5px solid var(--ink); display: grid; place-items: center; font: 600 0.9rem/1 ui-sans-serif, system-ui, sans-serif; }

footer { margin-top: 56px; padding-top: 20px; border-top: 1px solid var(--rule); }
</style>
</head>
<body>
<main>
  <h1>Your WhatsApp history, readable by your agent.</h1>
  <p class="lede">This server lets an AI agent search and read your WhatsApp messages. It can't send anything. It runs in your own Cloudflare account, so your messages are stored nowhere else.</p>

  <div class="chat" aria-label="Example conversation">
    <div class="bubble me">When did Dana say the flights were booked?</div>
    <div class="call">search_messages "flights booked" in Lisbon trip</div>
    <div class="bubble agent">Thursday evening. She wrote that she'd booked both and the confirmations were in your email.</div>
  </div>

  <ol class="steps">
    <li>
      <h2>Link your phone</h2>
      <p>You'll scan a QR code, the same way you'd add WhatsApp Web. The first link imports your history, which takes a minute or two.</p>
      <a class="button" href="/setup">Link WhatsApp</a>
    </li>
    <li>
      <h2>Connect your agent</h2>
      <p>In Claude Code, run this, then type <code>/mcp</code> and sign in:</p>
      <div class="cmd"><code id="cmd">${esc(command)}</code><button id="copy" type="button">Copy</button></div>
      <p class="muted">Any other MCP client works too. Point it at <code>${esc(mcp)}</code> and it will walk you through signing in.</p>
    </li>
  </ol>

  <footer class="muted">
    <p>It doesn't stay connected. When your agent asks, and once a day, it connects, collects what's new, and hangs up. Your phone keeps working normally.</p>
    <p>WhatsApp has no official API for this. It uses the same protocol as WhatsApp Web, so use it on your own account, read-only. <a href="${REPO}">Source and setup guide</a>. <a href="/privacy">Privacy policy</a>.</p>
  </footer>
</main>
<script>${copyScript}</script>
</body>
</html>`;
}
