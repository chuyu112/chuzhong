import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSpeechService, loadSpeechKey, SPEAKERS } from '../server/speech.mjs';

const input = { text: '两边同时减去五。', voice: 'doubao:random', rate: 0.9 };
function response(events) {
 const bytes = Buffer.from(events.map(e => JSON.stringify(e)).join('\n'));
 return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.subarray(i, i + 7)); c.close(); } }));
}
const complete = () => response([{ code: 0, data: Buffer.from('MP3-A').toString('base64') }, { code: 0, data: Buffer.from('MP3-B').toString('base64') }, { code: 20000000 }]);

test('speech reads a separate private key, with nonempty runtime env taking precedence', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'zhixu-speech-env-')), file = join(dir, '.env');
 try {
  await writeFile(file, 'DOUBAO_TTS_API_KEY="speech-test-key"\nARK_API_KEY=wrong-key');
  assert.equal(loadSpeechKey(file, {}), 'speech-test-key');
  assert.equal(loadSpeechKey(file, { DOUBAO_TTS_API_KEY: '' }), 'speech-test-key');
  assert.equal(loadSpeechKey(file, { DOUBAO_TTS_API_KEY: 'runtime-test-key' }), 'runtime-test-key');
  assert.equal(loadSpeechKey(join(dir, 'missing'), {}), '');
 } finally { await rm(dir, { recursive: true }); }
});

test('speech randomly selects among five 2.0 voices, decodes NDJSON, and scopes its cache to account and rate', async () => {
 const calls = [], indices = [0, 3, 0, 0, 0];
 const service = createSpeechService({ apiKey: 'private-test-key', choose: max => (indices.shift() ?? 0) % max, fetchImpl: async (url, options) => { calls.push({ url, ...options, body: JSON.parse(options.body) }); return complete(); } });
 assert.equal((await service.synthesize('student-A', input)).audio.toString(), 'MP3-AMP3-B');
 const request = calls[0];
 assert.equal(request.url, 'https://openspeech.bytedance.com/api/v3/tts/unidirectional');
 assert.equal(request.headers['X-Api-Key'], 'private-test-key');
 assert.equal(request.headers['X-Api-Resource-Id'], 'seed-tts-2.0');
 assert.equal(request.body.req_params.speaker, SPEAKERS[0].id);
 assert.equal(request.body.req_params.audio_params.speech_rate, -10);
 assert.equal(request.body.user.uid, 'student-A');
 assert.equal((await service.synthesize('student-A', input)).voiceId, SPEAKERS[4].id);
 assert.equal(calls.length, 2);
 assert.equal((await service.synthesize('student-A', input)).voiceId, SPEAKERS[0].id);
 assert.equal(calls.length, 2);
 await service.synthesize('student-B', input); assert.equal(calls.length, 3);
 await service.synthesize('student-A', { ...input, rate: 1.2 }); assert.equal(calls.length, 4);
 for (const invalid of [{ text: '' }, { text: '文'.repeat(6001) }, { ...input, voice: 'browser' }, { ...input, rate: '1' }, { ...input, rate: 99 }])
  await assert.rejects(service.synthesize('student-A', invalid), { status: 400 });
 assert.equal(calls.length, 4);
});

test('all five requested Doubao voices are accepted', async () => {
 const calls = [];
 const service = createSpeechService({ apiKey: 'private-test-key', choose: max => calls.length % max, fetchImpl: async (_, options) => { calls.push(JSON.parse(options.body).req_params.speaker); return complete(); } });
 for (let i = 0; i < SPEAKERS.length; i++) await service.synthesize('voice-check-' + i, input);
 assert.deepEqual(calls, SPEAKERS.map(speaker => speaker.id));
});

test('partial audio and provider errors are discarded; failures do not cache or disclose private data', async () => {
 let next = response([{ code: 0, data: 'YXVkaW8=' }]);
 const service = createSpeechService({ apiKey: 'private-test-key', fetchImpl: async () => next });
 for (const failure of [next, response([{ code: 0, data: 'YXVkaW8=' }, { code: 403, message: 'private-test-key' }]), response([{ code: 20000000 }]), new Response('secret', { status: 403 })]) {
  next = failure;
  await assert.rejects(service.synthesize('student', input), error => error.status === 502 && !error.message.includes('private-test-key'));
 }
 next = complete(); assert.equal((await service.synthesize('student', input)).audio.toString(), 'MP3-AMP3-B');
 await assert.rejects(createSpeechService({ apiKey: '' }).synthesize('student', input), { status: 503 });
});

test('cancellation and timeout abort upstream, release concurrency, and do not cache cancelled requests', async () => {
 let count = 0, pending = true;
 const service = createSpeechService({ apiKey: 'key', timeoutMs: 50, fetchImpl: async (_, { signal }) => {
  count++; if (!pending) return complete();
  return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')), { once: true }));
 } });
 const controller = new AbortController(), cancelled = service.synthesize('student', input, controller.signal);
 controller.abort(); await assert.rejects(cancelled, { name: 'AbortError' });
 await assert.rejects(service.synthesize('student', input), error => error.status === 502 && error.message.includes('超时'));
 pending = false; await service.synthesize('student', input); assert.equal(count, 3);
});

test('per-account rate limits protect paid speech calls and isolate other students', async () => {
 let count = 0;
 const service = createSpeechService({ apiKey: 'key', fetchImpl: async () => { count++; return complete(); } });
 for (let i = 0; i < 20; i++) await service.synthesize('student', { ...input, text: '讲解' + i });
 await assert.rejects(service.synthesize('student', input), { status: 429 });
 await service.synthesize('other-student', input); assert.equal(count, 21);
});
