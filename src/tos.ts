/**
 * Terms of service. Plain language, and as small as it can be while saying what is true: this is a
 * personal server, it comes with no warranty, and WhatsApp doesn't sanction how it works. Not legal
 * advice. If you run your own copy for anyone but yourself, have someone qualified read this first.
 */
import { esc, page, xLink } from './ui.js';

const REPO = 'https://github.com/finereli/whatsapp-mcp';

export function tosPage(operator?: string, hosted = false, contact?: string) {
  const who = hosted
    ? `<p>This service${operator ? `, run by ${contact ? `<a href="https://x.com/${contact}" rel="noopener">${esc(operator)}</a>` : esc(operator)},` : ''} lets you connect AI agents that search and read your own WhatsApp messages. The software is open source under the MIT license (<a href="${REPO}">source</a>), and you can run your own copy instead. You need an account, and an account is for one person and their own WhatsApp.</p>`
    : `<p>This server${operator ? `, run by ${esc(operator)},` : ''} lets its owner's AI agents search and read the owner's own WhatsApp messages. It is open source under the MIT license (<a href="${REPO}">source</a>). It is not a service offered to the public. Only the owner can sign in, and there are no accounts for anyone else.</p>`;
  return page('Terms of service', `
<h1>Terms of service</h1>
<p class="muted">Last updated October 19, 2026</p>

<p>Short version: ${hosted ? 'this is a small service with no promises. Use it at your own risk.' : 'this is a personal server, run by its owner for their own use. It comes with no promises. Use it at your own risk.'}</p>

<h2>What this is</h2>
${who}

${hosted ? `<h2>Limits</h2>
<p>The service is free and run by one person. The number of accounts is limited, and so is the size of each. A history that is too large to take is turned away when you link it, and an account that outgrows its limit stops adding new messages. The operator can suspend accounts that are used to harm others or the service. Running your own copy has none of these limits.</p>

` : ''}<h2>WhatsApp</h2>
<p>This is not made by, affiliated with, or endorsed by WhatsApp or Meta. It reads messages the same way WhatsApp Web does, through an unofficial library, and WhatsApp's own terms discourage that. ${hosted ? 'You' : 'The owner'} ${hosted ? 'are' : 'is'} responsible for how you use ${hosted ? 'your' : 'their'} WhatsApp account, including any restriction WhatsApp puts on it, which can include closing it. Use it on your own account only, and only to read.</p>

<h2>Other people's messages</h2>
<p>Your chats contain things other people wrote to you. Treat them as private. Don't use this to harm anyone, to break the law, or to read messages that aren't yours.</p>

${hosted ? `<h2>Your sign-in</h2>
<p>You sign in with Google through a login service, and that sign-in is what produces the key that locks your stored messages. The operator runs the login service and could work out the key, so the encryption protects against leaks, not against the operator. The <a href="/privacy">privacy policy</a> explains.</p>` : `<h2>Your password</h2>
<p>Your password makes the key that locks your stored messages. Nobody can recover your stored messages without it.</p>`}

<h2>No warranty</h2>
<p>The ${hosted ? 'service' : 'server'} is provided "as is". The copy of your history can be incomplete, out of date or wrong, and it can stop working without warning, for instance if WhatsApp changes how it works${hosted ? ', or if the operator stops running it' : ''}. Check anything important against WhatsApp itself before relying on it.</p>

<h2>Liability</h2>
<p>To the fullest extent the law allows, the people who wrote or run this software are not liable for any loss or damage that comes from using it.</p>

<h2>Changes and ending</h2>
<p>These terms, or the ${hosted ? 'service' : 'server'} itself, can change or stop at any time. You can stop whenever you like by choosing "Delete my data" on the dashboard, as described in the <a href="/privacy">privacy policy</a>, which also explains what ${hosted ? 'the service' : 'the server'} does with data.</p>

<h2>Questions</h2>
<p>Questions go in an <a href="${REPO}/issues">issue on GitHub</a>${contact ? `, or to ${xLink(contact)} on X` : ''}.</p>

<p style="margin-top:32px"><a href="/">Back</a></p>`);
}
