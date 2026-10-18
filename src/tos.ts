/**
 * Terms of service. Plain language, and as small as it can be while saying what is true: this is a
 * personal server, it comes with no warranty, and WhatsApp doesn't sanction how it works. Not legal
 * advice. If you run your own copy for anyone but yourself, have someone qualified read this first.
 */
import { esc, page } from './ui.js';

const REPO = 'https://github.com/finereli/whatsapp-mcp';

export function tosPage(operator?: string) {
  return page('Terms of service', `
<h1>Terms of service</h1>
<p class="muted">Last updated October 19, 2026</p>

<p>Short version: this is a personal server, run by its owner for their own use. It comes with no promises. Use it at your own risk.</p>

<h2>What this is</h2>
<p>This server${operator ? `, run by ${esc(operator)},` : ''} lets its owner's AI agents search and read the owner's own WhatsApp messages. It is open source under the MIT license (<a href="${REPO}">source</a>). It is not a service offered to the public. Only the owner can sign in, and there are no accounts for anyone else.</p>

<h2>WhatsApp</h2>
<p>This is not made by, affiliated with, or endorsed by WhatsApp or Meta. It reads messages the same way WhatsApp Web does, through an unofficial library, and WhatsApp's own terms may not allow that. The owner is responsible for how they use their WhatsApp account, including any restriction WhatsApp puts on it. Use it on your own account only, and only to read.</p>

<h2>Other people's messages</h2>
<p>Your chats contain things other people wrote to you. Treat them as private. Don't use this to harm anyone, to break the law, or to read messages that aren't yours.</p>

<h2>No warranty</h2>
<p>The server is provided "as is". The copy of your history can be incomplete, out of date or wrong, and it can stop working without warning, for instance if WhatsApp changes how it works. Check anything important against WhatsApp itself before relying on it.</p>

<h2>Liability</h2>
<p>To the fullest extent the law allows, the people who wrote or run this software are not liable for any loss or damage that comes from using it.</p>

<h2>Changes and ending</h2>
<p>These terms, or the server itself, can change or stop at any time. The owner can stop using it whenever they like by unlinking WhatsApp and removing Google access, as described in the <a href="/privacy">privacy policy</a>, which also explains what the server does with data.</p>

<h2>Questions</h2>
<p>Questions go in an <a href="${REPO}/issues">issue on GitHub</a>.</p>

<p style="margin-top:32px"><a href="/">Back</a></p>`);
}
