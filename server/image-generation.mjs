import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ALLOWED_FLOVA_HOST = hostname => hostname === 'flova.tv' || hostname.endsWith('.flova.tv');

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

function runEnvelope(stdout) {
  const lines = String(stdout).trim().split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index].trim();
    if (!line.startsWith('{')) continue;
    try {
      const envelope = JSON.parse(line);
      if (envelope?.code === 0 && envelope.data?.status === 'completed' && envelope.data?.terminal === true) return envelope.data;
    } catch { /* progress output is not the terminal result */ }
  }
  throw new Error('Flova did not return a completed image run');
}

function imageResourceUrl(result) {
  for (const message of [...(result.assistant_messages || [])].reverse()) {
    for (const artifact of [...(message.artifacts || [])].reverse()) {
      if (artifact.media_type !== 'image' || artifact.status !== 'success' || typeof artifact.resource_url !== 'string') continue;
      const url = new URL(artifact.resource_url);
      if (url.protocol === 'https:' && ALLOWED_FLOVA_HOST(url.hostname)) return url.href;
    }
  }
  throw new Error('Flova did not return a successful image resource');
}

export function createImageGenerationService({
  projectId = '',
  cliPath = 'flova',
  fetchImpl = fetch,
  execFileImpl = execFileAsync,
  timeoutMs = 180000,
} = {}) {
  let queue = Promise.resolve();
  const serialize = task => {
    const result = queue.then(task, task);
    queue = result.catch(() => {});
    return result;
  };

  return {
    configured: Boolean(projectId),
    model: 'Flova Image 2.5 Sunburst',
    async generate(prompt, _userId, signal) {
      if (!projectId) throw new Error('图片生成暂未配置');
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 12000) throw new Error('图片说明无效');
      return serialize(async () => {
        if (signal?.aborted) throw new Error('图片生成已取消');
        try {
          const content = [
            'Generate exactly one static educational image using Flova Image 2.5 Sunburst.',
            'Do not make a video, audio, or other media. Follow the learning image prompt accurately, preserve all facts, formulas, examples, and spatial relationships, and keep any visible text legible.',
            'Create a fresh standalone learning image for this request; do not reuse or modify earlier project assets.',
            `Learning image prompt:\n${prompt.trim()}`,
          ].join('\n\n');
          const { stdout } = await execFileImpl(cliPath, [
            '--verbose', 'run', projectId, '--content', content,
            '--timeout', String(Math.max(1, Math.ceil(timeoutMs / 1000))), '--no-color',
          ], {
            encoding: 'utf8', maxBuffer: 6 * 1024 * 1024,
            timeout: timeoutMs, signal,
          });
          if (signal?.aborted) throw new Error('图片生成已取消');
          const url = imageResourceUrl(runEnvelope(stdout));
          const response = await fetchImpl(url, { signal, cache: 'no-store' });
          if (!response.ok) throw new Error('Flova image download failed');
          const finalUrl = new URL(response.url || url);
          if (finalUrl.protocol !== 'https:' || !ALLOWED_FLOVA_HOST(finalUrl.hostname)) throw new Error('Unexpected Flova image host');
          const mimeType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
          if (!ALLOWED_IMAGE_TYPES.has(mimeType)) throw new Error('Flova returned an unsupported image type');
          const declaredSize = Number(response.headers.get('content-length') || 0);
          if (declaredSize > MAX_IMAGE_BYTES) throw new Error('Flova image is too large');
          const buffer = Buffer.from(await response.arrayBuffer());
          if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('Flova image is too large');
          return { buffer, mimeType };
        } catch (error) {
          if (signal?.aborted || error?.name === 'AbortError') throw new Error('图片生成已取消');
          if (error?.code === 'ETIMEDOUT' || error?.killed) throw new Error('图片生成超时');
          throw new Error('图片生成暂时失败');
        }
      });
    },
  };
}
