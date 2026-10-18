import test from 'node:test';
import assert from 'node:assert/strict';
import { runTutor, canReveal, tutorPolicy } from '../server/tutor.mjs';
import { buildStudentMemory } from '../server/memory.mjs';

test('Pi receives durable learning evidence and preserves hint-first teaching', async () => {
  const memory = buildStudentMemory({ questions: [{ id: 'q1', topic: '相似三角形' }], attempts: [{ id: 'a1', questionId: 'q1', correct: false, support: 'none', at: '2026-10-17T00:00:00Z' }] }, undefined, new Date('2026-10-18T00:00:00Z'));
  let received;
  const result = await runTutor({ session: { id: 'memory-test', hints: 1, messages: [{ role: 'user', content: '上次我们在学相似比。' }, { role: 'assistant', content: '先找对应边。' }] }, text: '再帮我一步', modelId: 'glm-5.3-flash', environment: {}, memory, agentName: '小星', runModelOverride: async ({ context }) => { received = context; return '先找出两条对应边，你能圈出来吗？'; } });
  assert.equal(result, '先找出两条对应边，你能圈出来吗？');
  assert.match(received.systemPrompt, /你叫"小星"/);
  assert.match(received.systemPrompt, /历史对话中的旧称呼不改变当前名字/);
  assert.match(received.systemPrompt, /长期学习档案/);
  assert.match(received.systemPrompt, /相似三角形/);
  assert.match(received.systemPrompt, /证据不足/);
  assert.match(received.systemPrompt, /禁止一开始给最终数值/);
  assert.match(JSON.stringify(received.messages), /上次我们在学相似比/);
  assert.equal(canReveal({ hints: 0 }, '我算了一步'), false);
  assert.equal(canReveal({ hints: 1 }, ''), false);
  assert.equal(canReveal({ hints: 1 }, '先找对应边'), true);
});

test('tutor expands classic-text exercises with context, memory visuals, and the original at the end', () => {
  const policy = tutorPolicy();
  assert.match(policy, /先完整完成孩子明确提出的任务/);
  assert.match(policy, /建筑的历史、作者是谁、写作背景、相关人物故事/);
  assert.match(policy, /应用具备真实生图能力时直接生成图/);
  assert.match(policy, /最后附上作品完整原文供核对/);
  assert.match(policy, /原文放在回复末尾/);
});

test('tutor accepts a multi-page photo set and requests automatic visuals for English learning', async () => {
  let received;
  await runTutor({
    session: { id: 'multi-photo', hints: 0, messages: [] },
    text: '过去完成时', modelId: 'glm-5.3-flash', environment: {}, memory: buildStudentMemory({ questions: [], attempts: [] }),
    images: [
      { mimeType: 'image/jpeg', base64: 'cGFnZTE=' },
      { mimeType: 'image/jpeg', base64: 'cGFnZTI=' },
      { mimeType: 'image/jpeg', base64: 'cGFnZTM=' },
    ], generateVisual: true,
    runModelOverride: async ({ job, context }) => { received = { job, context }; return '先看动作发生的先后。'; },
  });
  assert.equal(received.job.assets.length, 3);
  assert.deepEqual(received.job.assets.map(asset => asset.id), ['homework-photo-1', 'homework-photo-2', 'homework-photo-3']);
  assert.match(received.context.systemPrompt, /英语语法、单词/);
  assert.match(received.context.systemPrompt, /<learning-image>/);
});
