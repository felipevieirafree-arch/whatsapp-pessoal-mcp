/**
 * Conservative, account-local Workers AI speech budget.
 * Estimates are based on Cloudflare's published 46.63 neurons / audio minute;
 * always round upward and reserve the charge BEFORE invoking the model.
 * This is NOT an account-wide Cloudflare billing meter.
 */
export const AUDIO_NEURONS_PER_MINUTE = 46.63;
export const DAILY_AUDIO_NEURON_BUDGET = 350;
export const DAILY_AUDIO_REQUEST_LIMIT = 6;
export interface DailyAudioUsage { day: string; calls: number; estimatedNeurons: number }

export function utcDay(nowMs: number): string {
  if (!Number.isFinite(nowMs)) throw new Error('Invalid clock');
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function estimatedNeurons(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 120)
    throw new Error('Audio duration must be known and within 120 seconds');
  // Extra 20% buffer over the documented model rate.
  return Math.ceil(seconds / 60 * AUDIO_NEURONS_PER_MINUTE * 1.2);
}

export function reserveAudioBudget(current: DailyAudioUsage | null, seconds: number, nowMs: number): DailyAudioUsage {
  const day = utcDay(nowMs);
  const prev = current?.day === day ? current : null;
  const calls = prev?.calls ?? 0;
  const used = prev?.estimatedNeurons ?? 0;
  const needed = estimatedNeurons(seconds);
  if (calls >= DAILY_AUDIO_REQUEST_LIMIT || used + needed > DAILY_AUDIO_NEURON_BUDGET)
    throw new Error('Daily audio budget exhausted. No AI call was made.');
  return { day, calls: calls + 1, estimatedNeurons: used + needed };
}
