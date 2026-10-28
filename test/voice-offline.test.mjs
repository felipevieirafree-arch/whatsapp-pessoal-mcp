import assert from 'node:assert/strict';
import { validateVoice, recoverVoice, recognizeVoice, MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, WHISPER_MODEL } from '../src/voice-media.ts';

const key = Buffer.alloc(32, 2).toString('base64');
const ref = { mediaKey: key, directPath: '/v/t62/file', ptt: true, seconds: 5 };
let passed = 0;
const check = (name, fn) => { fn(); passed++; };
const fails = async (name, fn, re) => { await assert.rejects(fn, re); passed++; };
check('valid metadata', () => validateVoice(ref));
check('hard audio limits', () => { assert.equal(MAX_AUDIO_SECONDS, 120); assert.equal(MAX_AUDIO_BYTES, 6 * 1024 * 1024); });
check('untrusted host', () => assert.throws(() => validateVoice({ ...ref, url: 'https://example.com/audio' }), /not trusted/));
check('host spoofing', () => assert.throws(() => validateVoice({ ...ref, url: 'https://evilwhatsapp.net/audio' }), /not trusted/));
check('invalid relative path', () => assert.throws(() => validateVoice({ ...ref, directPath: '../secret' }), /Invalid audio path/));
check('long recording', () => assert.throws(() => validateVoice({ ...ref, seconds: 121 }), /two-minute/));
check('missing media key', () => assert.throws(() => validateVoice({ ...ref, mediaKey: '' }), /metadata/));
check('missing older media', () => assert.throws(() => validateVoice({ ...ref, directPath: '', url: undefined }), /not preserved/));
check('large metadata', () => assert.throws(() => validateVoice({ ...ref, fileLength: String(MAX_AUDIO_BYTES + 1) }), /size limit/));

const bytes = Buffer.from('mock ogg/opus bytes');
const downloader = async (media, kind) => {
  assert.equal(kind, 'audio');
  assert.equal(media.mediaKey.length, 32);
  return (async function* () { yield bytes.subarray(0, 5); yield bytes.subarray(5); })();
};
const audio = await recoverVoice(ref, downloader);
check('download streamed bytes', () => assert.deepEqual(Buffer.from(audio), bytes));
let captured;
const ai = { run: async (model, input) => { captured = { model, input }; return { text: 'Teste de transcrição.' }; } };
const transcript = await recognizeVoice(audio, ai);
check('Whisper mock input/output', () => {
  assert.equal(captured.model, WHISPER_MODEL);
  assert.equal(captured.input.language, 'pt');
  assert.equal(captured.input.task, 'transcribe');
  assert.deepEqual(Buffer.from(captured.input.audio, 'base64'), bytes);
  assert.equal(transcript, 'Teste de transcrição.');
});
await fails('empty audio', () => recognizeVoice(Buffer.alloc(0), ai), /Invalid audio size/);
await fails('empty AI transcript', () => recognizeVoice(audio, { run: async () => ({ text: ' ' }) }), /no transcript/);
await fails('large downloaded audio', () => recoverVoice(ref, async () => (async function* () { yield Buffer.alloc(MAX_AUDIO_BYTES + 1); })()), /maximum download size/);
await fails('empty downloaded audio', () => recoverVoice(ref, async () => (async function* () {})()), /no longer available/);
console.log('PASS ' + passed + ' media tests with no cloud requests');
