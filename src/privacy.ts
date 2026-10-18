/**
 * The privacy policy. It describes what this code actually does, so if you change what gets stored
 * or who can see it, change this page too.
 */
import { esc, page } from './ui.js';

const REPO = 'https://github.com/finereli/whatsapp-mcp';

export function privacyPage(operator?: string) {
  return page('Privacy policy', `
<h1>Privacy policy</h1>
<p class="muted">Last updated October 19, 2026</p>

<p>Short version: this server reads one person's WhatsApp messages and shows them only to that person's own AI agent. Nothing is sold, shared or used for advertising.</p>

<h2>Who runs this</h2>
<p>This is a personal server${operator ? `, run by ${esc(operator)}` : ''}. It is open source (<a href="${REPO}">source</a>), and each copy is run by one person, the owner, in their own Cloudflare account. Only the owner can sign in.</p>

<h2>What it reads</h2>
<p><strong>WhatsApp messages.</strong> The owner links their phone to the server as a linked device, the way WhatsApp Web works. The server then receives the owner's messages and chat names.</p>
<p><strong>Sign-in.</strong> The owner signs in with a password, or through a login service that confirms their email address. The server gets no access to anything else in the owner's Google account, including their contacts.</p>
<p><strong>Names.</strong> The owner's AI agent can save a name for a phone number, for example after finding it in the owner's contacts. The server stores the name and number the agent gives it, next to the messages. It never connects to a contacts service itself.</p>

<h2>What it keeps</h2>
<p>Message text (photos, voice notes and documents are kept only as labels like [image], never as files), chat and contact names, names the owner or their agent saved for phone numbers, and the WhatsApp session credentials. All of it lives in a database inside the owner's own Cloudflare account. This software stores nothing anywhere else.</p>

<h2>Who can see it</h2>
<p>Only the owner, and the AI agents the owner chooses to connect. When an agent searches or reads messages, the text it reads goes to whoever runs that agent, for example the company behind the AI model, under the owner's own agreement with them. Cloudflare hosts the data as infrastructure.</p>
<p>The server does not sell data, does not use it for advertising, does not use it to train models, and does not share it with anyone else. No person other than the owner reads it.</p>

<h2>Anyone else who tries to sign in</h2>
<p>If anyone other than the owner tries to sign in, they are turned away, and nothing about them is kept.</p>

<h2>Deleting your data</h2>
<p>Unlinking WhatsApp (the "Unlink and scan again" button, or asking the agent to relink) removes the server's access to WhatsApp but keeps the messages already stored. To delete everything, delete the Worker and its Durable Object storage in the Cloudflare dashboard.</p>

<h2>Questions and changes</h2>
<p>Questions go in an <a href="${REPO}/issues">issue on GitHub</a>. If this policy changes, the new version replaces this page and the date above changes with it.</p>

<p style="margin-top:32px"><a href="/tos">Terms of service</a></p>
<p><a href="/">Back</a></p>`);
}
