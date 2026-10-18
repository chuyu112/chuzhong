import test from 'node:test';
import assert from 'node:assert/strict';
import { runTutor, canReveal } from '../server/tutor.mjs';
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
