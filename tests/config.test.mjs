import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadModelEnvironment, availableModels } from '../server/config.mjs';

test('Grok is excluded from the application even when its shared provider is configured', () => {
 const models = availableModels({ JIEKOU_API_KEY: 'test-only', DEEPSEEK_API_KEY: 'test-only' });
 assert.equal(models.some(model => /grok/i.test(model.id + model.label)), false);
 assert.ok(models.find(model => model.id === 'deepseek-v4-flash')?.configured);
 assert.ok(models.find(model => model.id === 'gemini-3.8-flash')?.configured, 'keep other models on the shared provider');
});

test('speech credentials stay out of model-provider configuration', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'zhixu-model-env-'));
 const priorTts = process.env.DOUBAO_TTS_API_KEY, priorChat = process.env.DOUBAO_API_KEY;
 try {
  await writeFile(join(dir, '.env.runner'), 'DOUBAO_API_KEY=chat-model-key\nDOUBAO_TTS_API_KEY=speech-key\nGLM_API_KEY=glm-key');
  process.env.DOUBAO_TTS_API_KEY = 'runtime-speech-key'; process.env.DOUBAO_API_KEY = 'runtime-chat-key';
  const environment = loadModelEnvironment(dir);
  assert.deepEqual(environment, { DOUBAO_API_KEY: 'runtime-chat-key', GLM_API_KEY: 'glm-key' });
 } finally {
  if (priorTts === undefined) delete process.env.DOUBAO_TTS_API_KEY; else process.env.DOUBAO_TTS_API_KEY = priorTts;
  if (priorChat === undefined) delete process.env.DOUBAO_API_KEY; else process.env.DOUBAO_API_KEY = priorChat;
  await rm(dir, { recursive: true, force: true });
 }
});
