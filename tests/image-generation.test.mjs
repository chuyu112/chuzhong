import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createImageGenerationService, extractGeneratedImagePrompt, loadImageGenerationKey } from '../server/image-generation.mjs';

test('image prompt metadata is removed from the student-facing explanation', () => {
  const parsed = extractGeneratedImagePrompt('讲清楚过去完成时。\n<learning-image>{"prompt":"用时间线说明过去完成时"}</learning-image>');
  assert.equal(parsed.text, '讲清楚过去完成时。');
  assert.equal(parsed.prompt, '用时间线说明过去完成时');
  assert.deepEqual(extractGeneratedImagePrompt('普通回答').prompt, '');
  assert.equal(extractGeneratedImagePrompt('安全回答\n<learning-image>bad json</learning-image>').text, '安全回答');
});

test('image generation uses a server key, configured model, and opaque learner identifier', async () => {
  assert.equal(loadImageGenerationKey({ OPENAI_IMAGE_API_KEY: 'image-secret' }), 'image-secret');
  assert.equal(loadImageGenerationKey({ OPENAI_API_KEY: 'legacy-secret' }), 'legacy-secret');
  let request;
  const service = createImageGenerationService({
    apiKey: 'server-only-secret', model: 'gpt-image-2.5-flare',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ data: [{ b64_json: Buffer.from('generated-png').toString('base64') }] }) };
    },
  });
  assert.equal(service.configured, true);
  const result = await service.generate('past perfect visual timeline', 'student-id');
  assert.equal(request.url, 'https://api.openai.com/v1/images/generations');
  assert.equal(request.options.headers.authorization, 'Bearer server-only-secret');
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, 'gpt-image-2.5-flare');
  assert.equal(body.prompt, 'past perfect visual timeline');
  assert.equal(body.n, 1);
  assert.equal(body.safety_identifier, createHash('sha256').update('student-id').digest('hex'));
  assert.deepEqual(result, { buffer: Buffer.from('generated-png'), mimeType: 'image/png' });
});

test('image generation reports an unavailable setup without leaking provider details', async () => {
  const service = createImageGenerationService({ apiKey: '' });
  assert.equal(service.configured, false);
  await assert.rejects(service.generate('a diagram', 'student'), /暂未配置/);
  const failing = createImageGenerationService({ apiKey: 'key', fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: 'sensitive provider response' }) }) });
  await assert.rejects(failing.generate('a diagram', 'student'), error => error.message === '图片生成暂时失败' && !error.message.includes('sensitive'));
});
