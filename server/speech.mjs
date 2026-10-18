import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { DEFAULT_VOICE } from '../dist/voice-options.js';

const ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
// Official Doubao Voice catalog, TTS 2.0 voices in the seed-tts-2.0 resource.
export const MIZAI_SPEAKER = 'zh_female_mizai_uranus_bigtts';
const RESOURCE = 'seed-tts-2.0';
export const SPEAKERS = Object.freeze([
  { name: '小何', id: 'zh_female_xiaohe_uranus_bigtts' },
  { name: 'Vivi', id: 'zh_female_vv_uranus_bigtts' },
  { name: '咪仔', id: MIZAI_SPEAKER },
  { name: '桃子', id: 'zh_female_tianmeitaozi_uranus_bigtts' },
  { name: '梓梓', id: 'zh_female_qingchezizi_uranus_bigtts' }
]);
const fail = (status, message) => Object.assign(new Error(message), { status });

export function loadSpeechKey(file = new URL('../.env.media.local', import.meta.url), environment = process.env) {
  if (environment.DOUBAO_TTS_API_KEY?.trim()) return environment.DOUBAO_TTS_API_KEY.trim();
  try { return (parseEnv(readFileSync(file, 'utf8')).DOUBAO_TTS_API_KEY || '').trim(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return ''; }
}

export function createSpeechService({ apiKey, fetchImpl = fetch, timeoutMs = 90000, choose = randomInt } = {}) {
  const active = new Map(), windows = new Map(), cache = new Map(), previousSpeaker = new Map();
  let cacheBytes = 0, inFlight = 0;
  const maxCacheBytes = 32 * 1024 * 1024;
  const remove = key => { cacheBytes -= cache.get(key).audio.length; cache.delete(key); };
  return {
    configured: Boolean(apiKey),
    async synthesize(userId, input, signal) {
      if (!input || typeof input.text !== 'string' || !input.text.trim() || [...input.text].length > 6000)
        throw fail(400, '请选择 1—6000 字的内容朗读，较长讲解可以分段朗读。');
      const voice = input.voice || DEFAULT_VOICE, rate = input.rate ?? 1;
      if (voice !== DEFAULT_VOICE) throw fail(400, '请选择随机音色。');
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0.7 || rate > 1.3) throw fail(400, '朗读速度应在 0.7—1.3 倍之间。');
      if (!apiKey) throw fail(503, '豆包语音尚未配置，请联系管理员。');
      signal?.throwIfAborted();
      const text = input.text.trim(), now = Date.now();
      const choices = SPEAKERS.filter(speaker => speaker.id !== previousSpeaker.get(userId));
      const selected = choices[choose(choices.length)];
      previousSpeaker.set(userId, selected.id);
      const key = createHash('sha256').update(JSON.stringify([userId, selected.id, rate, text])).digest('hex');
      for (const [id, entry] of cache) if (entry.expires <= now) remove(id);
      if (cache.has(key)) return cache.get(key);
      for (const [id, entry] of windows) if (entry.expires <= now) windows.delete(id);
      const window = windows.get(userId) || { expires: now + 60000, count: 0 };
      if ((active.get(userId) || 0) >= 2 || inFlight >= 8 || window.count >= 20)
        throw fail(429, '语音准备得有些频繁，请稍等一会儿再试。');
      window.count++; windows.set(userId, window);
      active.set(userId, (active.get(userId) || 0) + 1); inFlight++;
      const controller = new AbortController(), abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, timeoutMs);
      try {
        const response = await fetchImpl(ENDPOINT, {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey, 'X-Api-Resource-Id': RESOURCE, 'X-Api-Request-Id': randomUUID() },
          body: JSON.stringify({ user: { uid: userId }, req_params: {
            text, speaker: selected.id,
            audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: Math.round((rate - 1) * 100) }
          } })
        });
        if (!response.ok || !response.body) throw new Error('provider unavailable');
        const decoder = new TextDecoder(), audio = [];
        let pending = '', bytes = 0, wireBytes = 0, complete = false;
        const consume = line => {
          if (!line.trim()) return;
          const event = JSON.parse(line);
          if (![0, 20000000].includes(event.code)) throw new Error('provider rejected synthesis');
          if (event.data) {
            if (typeof event.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(event.data)) throw new Error('invalid audio');
            const chunk = Buffer.from(event.data, 'base64'); bytes += chunk.length;
            if (bytes > 12 * 1024 * 1024) throw new Error('audio too large');
            audio.push(chunk);
          }
          if (event.code === 20000000) complete = true;
        };
        for await (const chunk of response.body) {
          wireBytes += chunk.length;
          if (wireBytes > 20 * 1024 * 1024) throw new Error('response too large');
          pending += decoder.decode(chunk, { stream: true });
          let end;
          while (!complete && (end = pending.indexOf('\n')) !== -1) {
            consume(pending.slice(0, end)); pending = pending.slice(end + 1);
          }
          if (complete) break;
          if (pending.length > 4 * 1024 * 1024) throw new Error('invalid stream');
        }
        if (!complete) consume(pending + decoder.decode());
        if (!complete || !bytes) throw new Error('incomplete audio');
        signal?.throwIfAborted();
        const result = Buffer.concat(audio);
        if (cache.has(key)) remove(key);
        while (cacheBytes + result.length > maxCacheBytes && cache.size) remove(cache.keys().next().value);
        const cached = { audio: result, voiceId: selected.id, voiceName: selected.name, expires: Date.now() + 600000 };
        cache.set(key, cached); cacheBytes += result.length;
        return cached;
      } catch {
        signal?.throwIfAborted();
        // Do not expose provider credentials, raw responses or a child's text.
        throw fail(502, controller.signal.aborted ? '语音准备超时，请再试一次。' : '豆包语音暂时无法播放，请稍后再试。');
      } finally {
        clearTimeout(timer); controller.abort(); signal?.removeEventListener('abort', abort);
        const remaining = active.get(userId) - 1;
        if (remaining) active.set(userId, remaining); else active.delete(userId);
        inFlight--;
      }
    }
  };
}
