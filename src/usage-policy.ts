/** Safety controls that require no Cloudflare services or external dependencies. */
export const MIN_MANUAL_SYNC_GAP_MS = 60 * 60 * 1000;

/** Return true when another WhatsApp pull would be wasteful. */
export function shouldSkipManualSync(lastPullMs: number, nowMs: number): boolean {
  return Number.isFinite(lastPullMs) && lastPullMs > 0 && Number.isFinite(nowMs) &&
    nowMs >= lastPullMs && nowMs - lastPullMs < MIN_MANUAL_SYNC_GAP_MS;
}

/** Auto-pull may only be enabled by the explicit opt-in string; off by default. */
export function autoSyncEnabled(flag: string | undefined): boolean {
  return flag === 'true';
}
