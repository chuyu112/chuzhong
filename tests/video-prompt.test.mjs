import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVideoPrompt, extractVideoBrief, validateVideoBrief, wantsLearningVideo } from '../server/video-prompt.mjs';
import { tutorPolicy } from '../server/tutor.mjs';
import { planLearningVideo } from '../server/video-planner.mjs';
import { buildStudentMemory } from '../server/memory.mjs';

const brief = {
  title: '靖康之耻', goal: '理解靖康之变与北宋灭亡、南宋建立的联系',
  facts: ['1127年，宋徽宗、宋钦宗被金军俘虏，北宋灭亡。', '同年赵构即位，史称南宋。'],
  scenes: [
    { seconds: 10, visual: '地图上金军向汴京推进，镜头进入宋代城墙。', camera: '地图缓慢推进至城门', narration: '北宋末年，金军南下，攻入都城汴京，也就是今天的河南开封。', label: '汴京' },
    { seconds: 10, visual: '时间线出现1127年，两位皇帝的插画随队伍北去。', camera: '平移跟随北行队伍', narration: '一一二七年，宋徽宗、宋钦宗被俘北去，北宋灭亡。这就是靖康之变。', label: '1127年' },
    { seconds: 10, visual: '地图转到应天府，赵构即位，画面连接南宋建立的时间节点。', camera: '拉远展示时间线', narration: '同年，赵构在应天府即位，史称南宋。记住：二帝被俘，北宋灭亡，南宋建立。', label: '南宋建立' },
  ],
};

test('ordinary questions never automatically request a video', () => {
  for (const text of ['靖康之耻', '视频是什么意思', '不要生成视频', '不用视频讲']) assert.equal(wantsLearningVideo(text), false, text);
  for (const text of ['用视频讲讲靖康之耻', '给我做个视频', '生成一段30s的视频']) assert.equal(wantsLearningVideo(text), true, text);
  assert.equal(wantsLearningVideo('靖康之耻', '视频'), true);
});

test('only a complete 30-second brief becomes a generation prompt; metadata is hidden', () => {
  const raw = '先把事件顺序理清楚。\n<learning-video>' + JSON.stringify(brief) + '</learning-video>';
  const parsed = extractVideoBrief(raw);
  assert.equal(parsed.text, '先把事件顺序理清楚。');
  assert.ok(parsed.brief.scenes.every(scene => !('label' in scene)), 'discard obsolete on-screen labels');
  const prompt = buildVideoPrompt(parsed.brief);
  assert.match(prompt, /真人实拍电影质感/);
  assert.match(prompt, /全片无字幕/);
  assert.match(prompt, /禁止二次元、动漫、卡通、赛璐璐/);
  assert.doesNotMatch(prompt, /短标签：/);
  for (const text of ['30秒', '480p', '16:9', '0—10秒', '10—20秒', '20—30秒', '二帝被俘']) assert.ok(prompt.includes(text));
  assert.throws(() => validateVideoBrief({ ...brief, scenes: brief.scenes.map(s => ({ ...s, seconds: 15 })) }));
  assert.throws(() => validateVideoBrief({ ...brief, scenes: brief.scenes.slice(0, 1) }));
  assert.throws(() => validateVideoBrief({ ...brief, scenes: brief.scenes.map(s => ({ ...s, narration: '字'.repeat(150) })) }));
  assert.equal(extractVideoBrief(raw + '<learning-video>{}</learning-video>').brief, null);
  assert.deepEqual(extractVideoBrief('正文<learning-video>{"bad":'), { text: '正文', brief: null });
});

test('video preparation preserves tutoring boundaries and does not alter ordinary chat', () => {
  const policy = tutorPolicy({ generateVideo: true });
  assert.match(policy, /作业尚未尝试的部分不在旁白或画面中泄露最终答案/);
  assert.match(policy, /不要包含孩子的姓名/);
  assert.match(policy, /不把再现场景当成真实历史影像/);
  assert.doesNotMatch(tutorPolicy(), /<learning-video>/);
});

test('the planner uses the existing conversation and repairs an invalid brief before generation', async () => {
  const session = { id: 'video-planning', hints: 1, messages: [{ role: 'user', content: '靖康之耻' }, { role: 'assistant', content: '1127年北宋灭亡，同年赵构即位。' }] };
  const before = structuredClone(session); let calls = 0;
  const result = await planLearningVideo({ session, modelId: 'glm-5.3-flash', environment: {}, memory: buildStudentMemory({ questions: [], attempts: [] }), runModelOverride: async ({ context }) => {
    calls++;
    assert.match(JSON.stringify(context.messages), /靖康之耻/);
    assert.match(context.systemPrompt, /不展示制作提示词|不要展示制作提示词/);
    return calls === 1 ? '<learning-video>{}</learning-video>' : '<learning-video>' + JSON.stringify(brief) + '</learning-video>';
  } });
  assert.equal(calls, 2);
  assert.equal(result.brief.title, '靖康之耻');
  assert.match(result.prompt, /480p/);
  assert.deepEqual(session, before);
});
