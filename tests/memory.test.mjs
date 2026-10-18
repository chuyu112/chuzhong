import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStudentMemory, memoryContext } from '../server/memory.mjs';
const questions = Array.from({ length: 8 }, (_, i) => ({ id: `q${i}`, topic: '二次函数', subject: '数学' }));
const attempt = (i, correct, extra = {}) => ({ id: `a${i}`, questionId: `q${i}`, correct, support: 'none', at: `2026-10-${10 + i}T04:00:00.000Z`, ...extra });
const diagnose = attempts => buildStudentMemory({ questions, attempts }, undefined, new Date('2026-10-18T10:00:00Z'));

test('one mistake remains insufficient evidence', () => {
  assert.equal(diagnose([attempt(0, false)]).topics[0].status, '证据不足');
});
test('identical retries and assisted answers cannot manufacture strengths', () => {
  const retries = Array.from({ length: 6 }, (_, i) => attempt(i, true, { questionId: 'q0' }));
  const assisted = [attempt(6, true, { support: 'hint' }), attempt(7, true, { support: 'solution' })];
  const memory = diagnose([...retries, ...assisted]);
  assert.equal(memory.strengths.length, 0);
  assert.equal(memory.topics[0].independentQuestions, 1);
});
test('untracked assistance in legacy records is not treated as independent', () => {
  const memory = diagnose(Array.from({ length: 6 }, (_, i) => attempt(i, true, { support: undefined })));
  assert.equal(memory.topics[0].independentQuestions, 0);
  assert.equal(memory.topics[0].unknownSupportAttempts, 6);
});
test('strengths and weaknesses cite observations across days', () => {
  assert.equal(diagnose(Array.from({ length: 5 }, (_, i) => attempt(i, true))).strengths.length, 1);
  const weak = diagnose([attempt(0, false), attempt(1, false), attempt(2, true)]);
  assert.equal(weak.weaknesses.length, 1);
  assert.deepEqual(weak.weaknesses[0].evidenceIds, ['a0', 'a1', 'a2']);
});
test('new evidence changes the diagnosis and stale strength requires a retest', () => {
  const rows = Array.from({ length: 8 }, (_, i) => attempt(i, i < 5));
  assert.equal(diagnose(rows).strengths.length, 0);
  const stale = buildStudentMemory({ questions, attempts: rows.slice(0, 5) }, undefined, new Date('2026-11-10'));
  assert.equal(stale.topics[0].status, '等待复测');
  assert.equal(stale.reviewQueue.length, 1);
});
test('help requests do not become failure evidence; context carries limitations', () => {
  const memory = buildStudentMemory({ questions, attempts: [], helpEvents: [{ topic: '二次函数', action: 'asked_for_help' }] });
  assert.equal(memory.weaknesses.length, 0);
  assert.match(memoryContext(memory), /自述偏好与作答事实要区分/);
});

test('recent independent evidence can replace earlier strengths and tracks observed progress',()=>{
 const qs=Array.from({length:16},(_,i)=>({id:`q${i}`,topic:'方程',subject:'数学'}));
 const attempts=qs.map((q,i)=>({id:`a${i}`,questionId:q.id,correct:i<8,support:'none',at:new Date(Date.UTC(2026,9,i+1)).toISOString()}));
 const current=buildStudentMemory({questions:qs,attempts},undefined,new Date('2026-10-18'));
 assert.equal(current.topics[0].status,'需要巩固');assert.equal(current.topics[0].independentQuestions,8);
 const improved=buildStudentMemory({questions:qs,attempts:attempts.map((a,i)=>({...a,correct:i>=8}))},undefined,new Date('2026-10-18'));
 assert.equal(improved.topics[0].status,'稳定强项');
 const observed=diagnose([attempt(0,false),attempt(1,true),attempt(2,true)]);
 assert.equal(observed.topics[0].progress.nextIndependentSuccessAfterError.days,1);
 assert.match(memoryContext(observed),/不能声称测出了学习速度/);
});
