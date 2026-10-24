import test from 'node:test';
import assert from 'node:assert/strict';
import { planLearningImage } from '../server/image-planner.mjs';
import { createImageJobs } from '../server/image-jobs.mjs';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

test('missing metadata is planned independently, repaired once, and does not rewrite the lesson', async () => {
  const session = { id: 'bio', hints: 0, messages: [{ role: 'user', content: '眼神放电是生物电吗？' }, { role: 'assistant', content: '这是比喻，神经细胞通过电信号传递信息。' }] };
  const before = structuredClone(session); let calls = 0;
  const result = await planLearningImage({ session, modelId: 'glm-5.3-flash', environment: {}, runModelOverride: async ({ context }) => {
    calls++; assert.match(JSON.stringify(context.messages), /眼神放电/);
    assert.doesNotMatch(context.systemPrompt, /<learning-video>/);
    return calls === 1 ? '格式错误' : JSON.stringify({ needed: true, prompt: '画出视觉信息经过神经系统处理的示意图，用箭头表示信号方向，不画眼睛对外放电。' });
  } });
  assert.equal(calls, 2); assert.match(result.prompt, /神经系统/); assert.deepEqual(session, before);
  for (const raw of ['{}', '{"needed":false}', '{"needed":false,"reason":"biology"}']) {
    await assert.rejects(planLearningImage({ session, modelId: 'glm-5.3-flash', environment: {}, runModelOverride: async () => raw }));
  }
  const skip = await planLearningImage({ session: { ...session, messages: [{ role: 'user', content: '谢谢' }, { role: 'assistant', content: '不客气。' }] }, modelId: 'glm-5.3-flash', environment: {}, runModelOverride: async () => '{"needed":false,"reason":"not_educational"}' });
  assert.equal(skip.prompt, '');
});

test('background fallback is idempotent, isolates the old topic and preserves new followups', async () => {
  const data = await mkdtemp(join(tmpdir(), 'image-fallback-')), docs = new Map();
  const read = (key, fallback) => structuredClone(docs.get(key) ?? fallback);
  const write = (key, value) => docs.set(key, structuredClone(value));
  const key = 'u:student:session:lesson';
  write(key, { id: 'lesson', messages: [{ role: 'user', content: '过去完成时' }, { role: 'assistant', content: 'had加过去分词。' }] });
  let release, plans = 0, generations = 0;
  const ready = new Promise(resolve => release = resolve);
  const jobs = createImageJobs({ read, write, data, provider: { configured: true, generate: async prompt => { generations++; assert.equal(prompt, '时间轴解释过去的过去'); return { buffer: Buffer.from('test image'), mimeType: 'image/png' }; } }, plan: async session => {
    plans++; await ready; assert.equal(session.messages.length, 2); assert.equal(session.messages[1].content, 'had加过去分词。'); return { prompt: '时间轴解释过去的过去' };
  } });
  try {
    const first = jobs.enqueue('student', 'lesson', 1, 'test-model');
    assert.equal(first.status, 'pending'); assert.equal(jobs.enqueue('student', 'lesson', 1, 'test-model').id, first.id);
    const current = read(key); current.messages.push({ role: 'user', content: '什么是光合作用？' }); write(key, current); release();
    for (let i = 0; i < 100 && jobs.get('student', first.id).status === 'pending'; i++) await delay(10);
    assert.equal(jobs.get('student', first.id).status, 'completed');
    assert.equal(plans, 1); assert.equal(generations, 1);
    const saved = read(key); assert.equal(saved.messages[2].content, '什么是光合作用？');
    assert.deepEqual(await readFile(join(data, 'illustrations', 'student', saved.messages[1].generatedImageRef.filename)), Buffer.from('test image'));
    assert.equal(jobs.get('different-student', first.id), null);
    assert.throws(() => jobs.enqueue('different-student', 'lesson', 1, 'test-model'));
    jobs.enqueue('student', 'lesson', 1, 'test-model'); assert.equal(generations, 1);
  } finally { release(); await rm(data, { recursive: true, force: true }); }
});

test('small talk skips paid generation and uncertain submitted jobs never regenerate', async () => {
  const docs = new Map(), read = (key, fallback) => structuredClone(docs.get(key) ?? fallback), write = (key, value) => docs.set(key, structuredClone(value));
  let calls = 0;
  const jobs = createImageJobs({ read, write, data: '/unused', provider: { configured: true, generate: async () => { calls++; throw new Error('must not generate'); } }, plan: async () => ({ prompt: '', reason: 'not_educational' }) });
  write('u:a:session:s', { id: 's', messages: [{ role: 'assistant', content: '不客气' }] });
  const job = jobs.enqueue('a', 's', 0, 'test-model'); await delay(10);
  assert.equal(jobs.get('a', job.id).status, 'skipped'); assert.equal(calls, 0);
  write('u:a:image-job:interrupted', { id: 'interrupted', userId: 'a', sessionId: 's', messageIndex: 0, status: 'pending', generationStartedAt: 'earlier' });
  jobs.start('a', 'interrupted'); assert.equal(jobs.get('a', 'interrupted').status, 'failed'); assert.equal(calls, 0);
});
