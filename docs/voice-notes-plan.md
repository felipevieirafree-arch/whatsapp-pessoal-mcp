# WhatsApp voice notes — safe implementation plan

## Objective
Transcribe user-requested WhatsApp voice notes inside the existing authenticated MCP service. No new permanently connected host, no media URLs given directly to the chat client, and no changes to the production Worker without a gated deployment.

## Audited baseline
- Cloudflare Worker `src/index.ts`, OAuth MCP in `src/mcp.ts`.
- Baileys protocol connection in `src/whatsapp-do.ts`.
- Per-user Durable Object SQLite, encrypted via `src/vault.ts` and `src/store.ts`.
- Prior ingestion stored only the caption `[voice note Ns]`. The original media key, URL and directPath were thrown away.
- Existing historical voice-note rows cannot be recovered from their duration and id alone.

## Implemented on this branch (phase 1)
- The incoming audio media descriptor is now sealed in the same encrypted message blob. Neither the audio bytes nor credentials are stored separately.
- Reimport of a duplicate message can backfill a missing voice descriptor.
- Deleting a message clears its stored audio descriptor.
- `list_voice_notes` lists date, id, duration label and recoverability, never exposing the media key.
- Tests cover encrypted metadata, backfill, deletion and safe inventory.

## Phase 2 — pending, not yet implemented
1. Add an authenticated `transcribe_voice_note(chat, message_id)` tool and Durable Object operation.
2. On-demand fetch media using the stored Baileys descriptor and dedicated media decryption logic. The existing read-only message-sync session must not be left connected.
3. Enforce allowlisted `audioMessage` only, maximum bytes/time, rate limiting and refusal on missing or deleted media.
4. For a Cloudflare Workers AI model: verify accepted input encoding, size, PT-BR performance and true current pricing. WhatsApp OGG/Opus may require transcoding to a supported model format; confirm experimentally in isolated test environment, rather than presuming it works.
5. Keep media bytes in memory only during request; never return decrypted bytes or direct media URL to the MCP client.
6. Decide the privacy boundary before calling a transcription provider; transcript contains personal data and should be returned only to the authenticated user.
7. Add mocked downloader and transcription provider tests, including bad/expired media, corrupted keys, absent historical descriptor, client timeouts and cost caps.
8. Validate `npm run typecheck`, `npm test` (Node version requirement per README), and test a throwaway Durable Object under Wrangler. Do not deploy without these checks.

## Restore older voice notes
Older records contain message id, chat id and label only. A complete WhatsApp history replay **might** re-send the original metadata, but it is not guaranteed. Never use `relink` automatically: it disconnects the user's existing session and requires QR scanning. Safest approach is verify a new voice note first and ask the user separately before a relink or historic-media recovery attempt.

## Production safeguards
Do not merge this branch until phase-1 checks pass. Keep production `main` untouched. Existing text tools, OAuth, encryption and scheduled sync remain unchanged. Metadata growth could affect SQLite row-write and storage quotas; observe costs and run limits before release.

## Security observation
The upstream repository is public and holds deployment templates; review `wrangler.jsonc` and history for resource IDs, but **never** commit secrets or personal audio. No secrets are required in this branch.
