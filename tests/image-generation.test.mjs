import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageGenerationService, extractGeneratedImagePrompt } from '../server/image-generation.mjs';

test('image prompt metadata is removed from the student-facing explanation', () => {
  const parsed = extractGeneratedImagePrompt('讲清楚过去完成时。\n<learning-image>{"prompt":"用时间线说明过去完成时"}</learning-image>');
  assert.equal(parsed.text, '讲清楚过去完成时。');
  assert.equal(parsed.prompt, '用时间线说明过去完成时');
  assert.deepEqual(extractGeneratedImagePrompt('普通回答').prompt, '');
  assert.equal(extractGeneratedImagePrompt('安全回答\n<learning-image>bad json</learning-image>').text, '安全回答');
});

test('Flova image generation runs Image 2.5 in the configured project and stores the returned image', async () => {
  const image = Buffer.from('generated-png');
  const resourceUrl = 'https://cdn-ap.flova.tv/images/generated.png?temporary=signature';
  const terminal = {
    code: 0,
    data: {
      status: 'completed', terminal: true,
      assistant_messages: [{ artifacts: [{ media_type: 'image', status: 'success', resource_url: resourceUrl }] }],
    },
  };
  let command;
  let downloaded;
  const service = createImageGenerationService({
    projectId: 'project-123', cliPath: '/usr/local/bin/flova', timeoutMs: 120000,
    execFileImpl: async (file, args, options) => {
      command = { file, args, options };
      return { stdout: `[00:00:00] done\n${JSON.stringify(terminal)}`, stderr: '' };
    },
    fetchImpl: async (url, options) => {
      downloaded = { url, options };
      return {
        ok: true, url,
        headers: { get: name => name === 'content-type' ? 'image/png' : String(image.length) },
        arrayBuffer: async () => image,
      };
    },
  });
  assert.equal(service.configured, true);
  const result = await service.generate('画出过去完成时的事件时间线', 'student-id');
  assert.equal(command.file, '/usr/local/bin/flova');
  assert.deepEqual(command.args.slice(0, 2), ['run', 'project-123']);
  assert.ok(command.args.includes('--timeout'));
  assert.ok(command.args.includes('--no-color'));
  assert.match(command.args[command.args.indexOf('--content') + 1], /Flova Image 2\.5 Sunburst/);
  assert.match(command.args[command.args.indexOf('--content') + 1], /画出过去完成时的事件时间线/);
  assert.equal(command.options.timeout, 120000);
  assert.equal(downloaded.url, resourceUrl);
  assert.equal(downloaded.options.cache, 'no-store');
  assert.deepEqual(result, { buffer: image, mimeType: 'image/png' });
});

test('Flova is unavailable without a configured project and provider details stay private', async () => {
  const missing = createImageGenerationService();
  assert.equal(missing.configured, false);
  await assert.rejects(missing.generate('a diagram', 'student'), /暂未配置/);

  const failing = createImageGenerationService({
    projectId: 'project-123',
    execFileImpl: async () => { throw new Error('secret-token and signed URL'); },
  });
  await assert.rejects(failing.generate('a diagram', 'student'), error => error.message === '图片生成暂时失败' && !error.message.includes('secret'));
});

test('Flova only downloads image URLs from its HTTPS domain', async () => {
  const terminal = {
    code: 0,
    data: {
      status: 'completed', terminal: true,
      assistant_messages: [{ artifacts: [{ media_type: 'image', status: 'success', resource_url: 'https://example.com/secret.png' }] }],
    },
  };
  const failing = createImageGenerationService({
    projectId: 'project-123',
    execFileImpl: async () => ({ stdout: JSON.stringify(terminal), stderr: '' }),
    fetchImpl: async () => { throw new Error('must not fetch an external domain'); },
  });
  await assert.rejects(failing.generate('a diagram', 'student'), /图片生成暂时失败/);
});
