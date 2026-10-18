import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLearningFeedback, practiceEncouragement } from '../server/learning-feedback.mjs';

test('celebrations require quoted current work, valid metadata, and a new success', () => {
  const marker = value => `<learning-feedback>${JSON.stringify(value)}</learning-feedback>`;
  const correct = { kind: 'correct_step', evidence: '两边都减5' };
  const response = '对啦！你保持了等式两边的平衡。\n' + marker(correct);
  const result = parseLearningFeedback(response, '我先两边都减5，得到3x=15');
  assert.deepEqual(result.feedback, correct); assert.equal(result.text, '对啦！你保持了等式两边的平衡。');
  assert.equal(parseLearningFeedback(response, '我做对了').feedback, null);
  assert.equal(parseLearningFeedback(response, '两边都减5', [{ feedback: correct }]).feedback, null);
  for (const value of [{kind:'correct_step', evidence:'我做对了'}, {kind:'wrong', evidence:'两边都减5'}, {kind:'correct_step',evidence:42}]) {
    const parsed=parseLearningFeedback('我们看看。'+marker(value),'我做对了，两边都减5');
    assert.equal(parsed.feedback,null);assert.ok(!parsed.text.includes('learning-feedback'));
  }
  assert.equal(parseLearningFeedback('这步要改一下。','我想是x=6').feedback,null);
  assert.equal(parseLearningFeedback('对啦。<learning-feedback>{bad json}</learning-feedback>','5').feedback,null);
  assert.equal(parseLearningFeedback('先试一步。<learning-feedback>{','请教我').text,'先试一步。');
  assert.equal(parseLearningFeedback(response+marker(correct),'两边都减5').feedback,null);
});

test('practice encouragement distinguishes a corrected answer, supported work and an error', () => {
  assert.match(practiceEncouragement({questionId:'q',correct:true,support:'none'},[]),/答案核对正确/);
  assert.match(practiceEncouragement({questionId:'q',correct:true,support:'hint'},[]),/借助提示/);
  assert.match(practiceEncouragement({questionId:'q',correct:true},[{questionId:'q',correct:false}]),/修正/);
  assert.doesNotMatch(practiceEncouragement({questionId:'q',correct:false},[]),/答对啦|做对啦/);
});
