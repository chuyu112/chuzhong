import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';

const ENDPOINT = 'https://api.openai.com/v1/images/generations';
const DEFAULT_MODEL = 'gpt-image-2.5-flare';

export function loadImageGenerationKey(environment = process.env) {
  const direct = environment.OPENAI_IMAGE_API_KEY?.trim() || environment.OPENAI_API_KEY?.trim();
  if (direct) return direct;
  for (const file of [new URL('../.env.education.local', import.meta.url), new URL('../.env.media.local', import.meta.url)]) {
    try {
      const values = parseEnv(readFileSync(file, 'utf8'));
      const key = values.OPENAI_IMAGE_API_KEY?.trim() || values.OPENAI_API_KEY?.trim();
      if (key) return key;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return '';
}

export function extractGeneratedImagePrompt(raw) {
  let prompt = '';
  const matches = [...String(raw).matchAll(/<learning-image>([\s\S]*?)<\/learning-image>/gi)];
  if (matches.length === 1) {
    try {
      const value = JSON.parse(matches[0][1]);
      if (typeof value.prompt === 'string' && value.prompt.trim().length <= 12000) prompt = value.prompt.trim();
    } catch { /* malformed model metadata is stripped and never shown to the student */ }
  }
  const text = String(raw).replace(/<learning-image>[\s\S]*?(?:<\/learning-image>|$)/gi, '').trim();
  return { text, prompt };
}

export function createImageGenerationService({ apiKey, model = DEFAULT_MODEL, fetchImpl = fetch, timeoutMs = 150000 } = {}) {
  return {
    configured: Boolean(apiKey),
    model,
    async generate(prompt, userId, signal) {
      if (!apiKey) throw new Error('图片生成暂未配置');
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 12000) throw new Error('图片说明无效');
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, timeoutMs);
      try {
        const response = await fetchImpl(ENDPOINT, {
          method: 'POST', signal: controller.signal,
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            prompt: prompt.trim(),
            size: '1536x1024',
            quality: 'medium',
            output_format: 'png',
            n: 1,
            safety_identifier: createHash('sha256').update(String(userId)).digest('hex'),
          }),
        });
        if (!response.ok) throw new Error('图片服务暂时无法完成生成');
        const result = await response.json();
        const encoded = result?.data?.[0]?.b64_json;
        if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > 32 * 1024 * 1024) {
          throw new Error('图片服务返回了无效结果');
        }
        const buffer = Buffer.from(encoded, 'base64');
        if (!buffer.length || buffer.length > 24 * 1024 * 1024) throw new Error('生成的图片大小无效');
        return { buffer, mimeType: 'image/png' };
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error(controller.signal.aborted ? '图片生成超时' : '图片生成暂时失败');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}
