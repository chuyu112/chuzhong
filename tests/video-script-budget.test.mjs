import test from 'node:test';
import assert from 'node:assert/strict';
import { runTutor } from '../server/tutor.mjs';
import { buildStudentMemory } from '../server/memory.mjs';

test('video planning receives its own output budget through the real tutor and Responses runtime', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.match(url, /^https:\/\/api\.deepseek\.com\/.*responses$/);
    requests.push(JSON.parse(init.body));
    return Response.json({ status: 'completed', output_text: '完整回复' });
  });
  for (const generateVideo of [false, true]) {
    const result = await runTutor({ session: { id: `budget-${generateVideo}`, hints: 0, messages: [] }, text: '整理脚本', generateVideo, modelId: 'deepseek-v4-flash', environment: { DEEPSEEK_API_KEY: 'test-only-key' }, memory: buildStudentMemory({ questions: [], attempts: [] }) });
    assert.equal(result, '完整回复');
  }
  assert.deepEqual(requests.map(request => request.max_output_tokens), [4096, 32768]);
});
