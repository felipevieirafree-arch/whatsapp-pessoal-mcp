/**
 * The privacy policy. Google requires one at a stable URL on your own domain before an OAuth app can
 * go to production. It describes what this code actually does, so if you change what gets stored or
 * who can see it, change this page too.
 */
import { esc, page } from './ui.js';

const REPO = 'https://github.com/finereli/whatsapp-mcp';

export function privacyPage(operator?: string) {
  return page('Privacy policy', `
<h1>Privacy policy</h1>
<p class="muted">Last updated October 18, 2026</p>

<p>Short version: this server reads one person's WhatsApp messages and Google contacts, and shows them only to that person's own AI agent. Nothing is sold, shared or used for advertising.</p>

<h2>Who runs this</h2>
<p>This is a personal server${operator ? `, run by ${esc(operator)}` : ''}. It is open source (<a href="${REPO}">source</a>), and each copy is run by one person, the owner, in their own Cloudflare account. Only the owner can sign in.</p>

<h2>What it reads</h2>
<p><strong>WhatsApp messages.</strong> The owner links their phone to the server as a linked device, the way WhatsApp Web works. The server then receives the owner's messages and chat names.</p>
<p><strong>Google account.</strong> The owner signs in with Google. The server sees the account's email address and name, to check that the person signing in is the owner.</p>
<p><strong>Google contacts.</strong> With the owner's permission, the server reads the names and phone numbers of the owner's saved contacts and "other contacts", read-only. It uses them for one thing: putting names on WhatsApp chats that would otherwise show only a phone number.</p>

<h2>What it keeps</h2>
<p>Message text (photos, voice notes and documents are kept only as labels like [image], never as files), chat and contact names, the WhatsApp session credentials, a Google refresh token, and contact names with their phone numbers. All of it lives in a database inside the owner's own Cloudflare account. This software stores nothing anywhere else.</p>

<h2>Who can see it</h2>
<p>Only the owner, and the AI agents the owner chooses to connect. When an agent searches or reads messages, the text it reads goes to whoever runs that agent, for example the company behind the AI model, under the owner's own agreement with them. Cloudflare hosts the data as infrastructure.</p>
<p>The server does not sell data, does not use it for advertising, does not use it to train models, and does not share it with anyone else. No person other than the owner reads it.</p>

<h2>Google user data</h2>
<p>This server's use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>

<h2>Anyone else who tries to sign in</h2>
<p>If anyone other than the owner signs in with Google, they are turned away, and nothing about them is kept.</p>

<h2>Deleting your data</h2>
<p>Unlinking WhatsApp (the "Unlink and scan again" button, or asking the agent to relink) removes the server's access to WhatsApp but keeps the messages already stored. To stop it reading your contacts, remove the app at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>. To delete everything, delete the Worker and its Durable Object storage in the Cloudflare dashboard.</p>

<h2>Questions and changes</h2>
<p>Questions go in an <a href="${REPO}/issues">issue on GitHub</a>. If this policy changes, the new version replaces this page and the date above changes with it.</p>

<p style="margin-top:32px"><a href="/tos">Terms of service</a></p>
<p><a href="/">Back</a></p>`);
}
