/** The front page: what this is, the two steps to use it, and what it does and doesn't promise. Nothing private on it, since anyone can load it. */

import { baseCss, copyScript, esc, xLink } from './ui.js';

const REPO = 'https://github.com/finereli/whatsapp-mcp';
const REPO_API = 'https://api.github.com/repos/finereli/whatsapp-mcp';

const starIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z"/></svg>`;
const githubIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/></svg>`;

/** `signupLimit` and `maxMessages` are the caps in force, 0 for none. `contact` is the operator's X handle. */
export function landingPage(origin: string, hosted = false, caps: { signupLimit?: number; maxMessages?: number; contact?: string } = {}): string {
  const mcp = `${origin}/mcp`;
  const claudeCode = `claude mcp add --transport http whatsapp ${mcp}`;
  const subline = hosted
    ? 'Connect ChatGPT, Claude or Grok to your WhatsApp, for free.'
    : 'Connect ChatGPT, Claude or Grok to your WhatsApp. It runs in your own Cloudflare account.';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp MCP</title>
<meta name="description" content="${esc(subline)} Read-only, stored encrypted, open source.">
<style>
${baseCss}
main { padding-top: 64px; }
h1 { font-size: clamp(2.6rem, 10vw, 4rem); margin-bottom: 14px; }
.lede { font-size: 1.2rem; max-width: 38rem; margin-bottom: 26px; }

.actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 10px; }
.repo { display: inline-flex; align-items: center; gap: 9px; padding: 12px 16px; border-radius: 10px; border: 1.5px solid var(--ink); text-decoration: none; font: 600 0.95rem/1 ui-sans-serif, system-ui, sans-serif; }
.repo:hover { background: var(--code); }
.repo .count { display: none; align-items: center; gap: 5px; padding-left: 10px; margin-left: 2px; border-left: 1.5px solid var(--rule); }
.repo .count.on { display: inline-flex; }
.oss { margin: 0 0 8px; }

.chat { margin: 40px 0 48px; display: grid; gap: 10px; }
.bubble { max-width: 82%; padding: 10px 14px; border-radius: 16px; line-height: 1.45; }
.bubble.me { justify-self: end; background: var(--mine); border-bottom-right-radius: 4px; }
.bubble.agent { justify-self: start; background: var(--theirs); border-bottom-left-radius: 4px; border: 1px solid var(--rule); }
.call { justify-self: start; margin: 0 0 0 6px; color: var(--muted); font: 0.84rem/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }

.steps { list-style: none; padding: 0; margin: 0; display: grid; gap: 30px; counter-reset: step; }
.steps > li { counter-increment: step; padding-left: 44px; position: relative; }
.steps > li::before { content: counter(step); position: absolute; left: 0; top: 1px; width: 28px; height: 28px; border-radius: 50%; border: 1.5px solid var(--ink); display: grid; place-items: center; font: 600 0.9rem/1 ui-sans-serif, system-ui, sans-serif; }
.alt { margin: 0; }

.terms { margin-top: 64px; display: grid; gap: 34px; }
.facts { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 14px; }
.facts li { padding-left: 18px; border-left: 3px solid var(--rule); max-width: 34rem; }
.facts.yes li { border-left-color: var(--action); }
.facts strong { display: block; }

footer { margin-top: 56px; padding-top: 20px; border-top: 1px solid var(--rule); }
</style>
</head>
<body>
<main>
  <h1>WhatsApp MCP</h1>
  <p class="lede">${esc(subline)}</p>

  <div class="actions">
    <a class="button" href="/setup">${hosted ? 'Get started' : 'Link WhatsApp'}</a>
    <a class="repo" href="${REPO}" rel="noopener">${githubIcon}<span>Open source on GitHub</span><span class="count" id="stars">${starIcon}<span id="starCount"></span></span></a>
  </div>
  <p class="muted oss">MIT licensed. ${hosted ? 'Use this one, or run your own copy.' : 'Read it, change it, fork it.'} Built by ${xLink('finereli')}.</p>

  <div class="chat" aria-label="Example conversation">
    <div class="bubble me">When did Dana say the flights were booked?</div>
    <div class="call">search_messages "flights booked" in Lisbon trip</div>
    <div class="bubble agent">Thursday evening. She wrote that she'd booked both and the confirmations were in your email.</div>
  </div>

  <ol class="steps">
    <li>
      <h2>${hosted ? 'Sign up and link your phone' : 'Link your phone'}</h2>
      <p>${hosted ? 'Pick a password, then scan' : "You'll scan"} a QR code, the same way you'd add WhatsApp Web. The first link imports your history, which takes a minute or two.</p>
    </li>
    <li>
      <h2>Connect your assistant</h2>
      <p>Add this address as an MCP server (ChatGPT calls it a connector) and sign in when it asks:</p>
      <div class="cmd"><code id="cmd">${esc(mcp)}</code><button id="copy" type="button">Copy</button></div>
      <p class="muted alt">In Claude Code: <code>${esc(claudeCode)}</code>, then type <code>/mcp</code>. Grok and any other client that speaks MCP work the same way.</p>
    </li>
  </ol>

  <section class="terms" aria-label="What this promises">
    <div>
      <h2>What you can count on</h2>
      <ul class="facts yes">
        <li><strong>It only reads.</strong>It can search and read your messages and remember names you give it. It can't send, edit or delete anything in WhatsApp.</li>
        <li><strong>Your messages are stored encrypted.</strong>The key is made from your password and never stored in the clear. Without the password the stored copy is unreadable to everyone, including ${hosted ? 'whoever runs this service' : 'anyone with access to the database'}. There is no master key.</li>
        <li><strong>You can check.</strong>The code is open source, and ${hosted ? 'you can run your own copy for the price of a Cloudflare account' : 'this is your own copy'}.</li>
        <li><strong>You can leave.</strong>One button on your dashboard unlinks WhatsApp and erases everything.</li>
      </ul>
    </div>
    <div>
      <h2>What it doesn't promise</h2>
      <ul class="facts">
        <li><strong>It isn't end-to-end encryption.</strong>While your assistant is reading, the server sees your messages in plain text, and your assistant's provider sees whatever it reads. ${hosted ? 'An operator who changed the code could capture passwords, which is why it is open source.' : ''}</li>
        <li><strong>A lost password can't be reset.</strong>The stored messages are gone for good. You'd link again and get whatever history WhatsApp sends.</li>
        <li><strong>WhatsApp doesn't allow this.</strong>It uses the same protocol as WhatsApp Web through an unofficial library, so WhatsApp could restrict or close your account. Use it on your own account, read-only.</li>
        <li><strong>The people in your chats haven't agreed to it.</strong>Their messages to you are in there too. Decide if you're comfortable with that before you link.</li>
        ${hosted && (caps.signupLimit || caps.maxMessages)
          ? `<li><strong>Spots are limited.</strong>${[caps.signupLimit ? `This service takes ${caps.signupLimit.toLocaleString()} people` : '', caps.maxMessages ? `${caps.signupLimit ? ' and ' : 'It takes '}accounts of up to ${caps.maxMessages.toLocaleString()} messages` : ''].join('')}. Anything bigger can run its own copy${caps.contact ? `, or message ${xLink(caps.contact)} on X` : ''}.</li>`
          : ''}
      </ul>
    </div>
  </section>

  <footer class="muted">
    <p>It doesn't stay connected. When your assistant asks, it connects, collects what's new, and hangs up. Your phone keeps working normally.</p>
    <p><a href="${REPO}">Source and setup guide</a>. <a href="/privacy">Privacy policy</a>. <a href="/tos">Terms of service</a>.${caps.contact ? ` Questions: ${xLink(caps.contact)} on X.` : ''}</p>
  </footer>
</main>
<script>${copyScript}
(function () {
  fetch(${JSON.stringify(REPO_API)}).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    if (!j || typeof j.stargazers_count !== 'number') return;
    document.getElementById('starCount').textContent = j.stargazers_count.toLocaleString();
    document.getElementById('stars').className = 'count on';
  }).catch(function () {});
})();</script>
</body>
</html>`;
}
