# Safety and release status — 2026-10-28

User requirement: **no additional charges and do not deplete free-tier limits**.

This branch now includes:
- Encrypted media metadata retention, voice note inventory and best-effort historical backfill.
- In-memory media recovery adapter with maximum size and duration.
- An opt-in transcription entrypoint, disabled unless ENABLE_VOICE_TRANSCRIPTION=true.
- No Workers AI binding or billing change.
- Default-off automatic refresh (AUTO_SYNC_ON_READ) and manual sync (ENABLE_MANUAL_SYNC).
- 2,000-row bound on expensive encrypted message searches, with explicit truncation notice.
- A 60-minute sync cooldown when manual sync is explicitly enabled.
- Offline policy tests: 12/12 passed; isolated TypeScript check passed.

**NOT validated:** full npm typecheck/test suite, Cloudflare Workers runtime compatibility, Baileys media download on a real audio, Whisper input format and quota caps, recovery of older voice notes.

**Do not merge/deploy this branch yet.** Tests and an isolated compatible runtime are required first. Every cloud request still uses some free-plan quota. Zero paid charges is possible only if account billing cannot overrun the free plan and no paid model is activated. This branch leaves transcription disabled.

The October 27 Rafaela recordings are still labels only in the existing production database. No claim is made that they can be recovered without a new source for their media descriptors.
