# Recent-first, free-tier-first WhatsApp MCP

User constraints: **zero new billed spend**. Keep existing Cloudflare Free account, no new account, no paid billing, no historical data deletion.

## Daily workflow
1. list_chats returns chats with messages from the last 72h by default (up to 168h), with indexed date filtering.
2. search_messages defaults to the last 72h. For older searches, specify since/until and ideally an exact chat JID.
3. get_messages still reads a specific chat's latest entries. Old messages are not deleted.
4. auto-sync-on-read and manual sync are both OFF unless separately enabled in config.
5. Pairing-page status stops polling after a completed link and avoids repeated full-database counts.

## Cost and quota protection
- Workers/Durable Objects Free limits fail closed after their allowances, but still consume scarce free quotas when called. See official Cloudflare pricing for account-wide limits.
- Workers AI offers 10,000 free neurons/day but consumes an unpredictable amount per transcription based on model and audio. Not identical to LLM tokens. Usage should be monitored in Workers AI dashboard and inference must remain OFF until verified.
- NEVER turn on workers paid, prepaid AI gateway billing, or a payment method. Model activation requires a measured per-audio cost and a hard on-device/server-side daily quota that is not yet implemented.
- DO NOT create another Cloudflare account simply to bypass resource limits; optimize the existing one.
- No automatic backfill/import of the 55k legacy messages. Existing encrypted history stays in place.

## Validation gates
- Full npm install, npm run typecheck and npm test in a local isolated environment.
- Mock testing of 72h window, explicit old search, cache invalidation, streamed audio bounds.
- Smoke test of a new, user-owned voice note in a safe deployment only after successful local checks and account-level Free-tier confirmation.
- Confirm deployed code is the tested commit, and measure DO rows read/write for one normal conversation request.
- Verify audio model input and inference quota live before ever enabling transcription.
- Confirm real account quota telemetry; no tool in this session exposes Cloudflare billing data directly.

## Current state
Development branch only; no deployment or Cloudflare sync performed by this change. Existing old Rafaela voice notes lack media metadata, so historic recovery is unproven.
