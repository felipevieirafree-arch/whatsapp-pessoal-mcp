/** Recover audio bytes on demand. No media is persisted or returned to an MCP client. */
import { Buffer } from 'node:buffer';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import type { VoiceNoteRef } from './store.js';

export const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 120;
export const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';

function allowedHost(hostname: string): boolean {
  return ['whatsapp.net', 'whatsapp.com', 'fbcdn.net'].some(
    root => hostname === root || hostname.endsWith('.' + root),
  );
}

export function validateVoice(ref: VoiceNoteRef): void {
  const key = Buffer.from(ref.mediaKey || '', 'base64');
  if (key.length !== 32) throw new Error('Voice media metadata is incomplete.');
  if (!ref.directPath && !ref.url) throw new Error('Audio location was not preserved; old messages may need to be re-imported.');
  if (ref.directPath && (!ref.directPath.startsWith('/') || ref.directPath.startsWith('//') || ref.directPath.includes('\\')))
    throw new Error('Invalid audio path.');
  if (ref.url) {
    let u: URL;
    try { u = new URL(ref.url); } catch { throw new Error('Invalid audio URL.'); }
    if (u.protocol !== 'https:' || !allowedHost(u.hostname.toLowerCase()) || u.username || u.password || u.port)
      throw new Error('Audio host is not trusted.');
  }
  if (ref.seconds != null && (ref.seconds <= 0 || ref.seconds > MAX_AUDIO_SECONDS))
    throw new Error('Audio exceeds the two-minute limit.');
  if (ref.fileLength && (Number(ref.fileLength) > MAX_AUDIO_BYTES || Number(ref.fileLength) < 0))
    throw new Error('Audio exceeds the size limit.');
}

export async function recoverVoice(
  ref: VoiceNoteRef,
  downloader: typeof downloadContentFromMessage = downloadContentFromMessage,
): Promise<Uint8Array> {
  validateVoice(ref);
  const stream = await downloader({
    mediaKey: Buffer.from(ref.mediaKey, 'base64'),
    ...(ref.directPath ? { directPath: ref.directPath } : {}),
    ...(ref.url ? { url: ref.url } : {}),
  }, 'audio');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const b = Buffer.from(chunk);
    size += b.length;
    if (size > MAX_AUDIO_BYTES) throw new Error('Audio exceeds maximum download size.');
    chunks.push(b);
  }
  if (!size) throw new Error('Audio is no longer available for download.');
  return Buffer.concat(chunks);
}

export interface SpeechProvider {
  run(model: string, input: { audio: string; language: string; task: string }): Promise<unknown>;
}

export async function recognizeVoice(audio: Uint8Array, provider: SpeechProvider): Promise<string> {
  if (audio.length === 0 || audio.length > MAX_AUDIO_BYTES) throw new Error('Invalid audio size.');
  const result = await provider.run(WHISPER_MODEL, {
    audio: Buffer.from(audio).toString('base64'),
    language: 'pt',
    task: 'transcribe',
  });
  const transcript = (result as { text?: unknown } | null)?.text;
  if (typeof transcript !== 'string' || !transcript.trim()) throw new Error('Speech recognizer returned no transcript.');
  return transcript.trim();
}
