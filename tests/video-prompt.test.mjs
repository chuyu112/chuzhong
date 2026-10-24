import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVideoPrompt, extractVideoBrief, validateVideoBrief, wantsLearningVideo } from '../server/video-prompt.mjs';
import { tutorPolicy } from '../server/tutor.mjs';
import { planLearningVideo } from '../server/video-planner.mjs';
import { buildStudentMemory } from '../server/memory.mjs';

const brief = {
  title: '靖康之耻', goal: '理解靖康之变与北宋灭亡、南宋建立的联系',
  facts: ['1127年，宋徽宗、宋钦宗被金军俘虏，北宋灭亡。', '同年赵构即位，史称南宋。'],
  continuity: '宋代历史真人再现。徽宗为年长男子、钦宗为成年男子，两人穿朴素灰色宋式长袍；赵构为年轻男子，穿深红宋式袍服。城门为第一二镜的空间锚点，第三镜另切官署内景。低饱和自然光，无文字道具。',
  scenes: [
    { seconds: 10, purpose: '交代金军进攻与北宋都城危机', start: '汴京城门关闭，守军在墙上戒备', visual: '远处金军逐渐接近城门，守军转身传递警讯', camera: '城墙中远景缓慢推近，焦点保持在守军与城门', end: '停在沉重的城门，下一镜切到城门外', sound: '低沉脚步与城外风声', narration: '北宋末年，金军南下，攻入都城汴京，也就是今天的河南开封。', label: '汴京' },
    { seconds: 10, purpose: '说明两位皇帝被俘与北宋灭亡', start: '切到城门外，徽宗和钦宗站在看守身前', visual: '看守引导两人离开城门，二人回望后随队伍前行', camera: '中景平移跟随二人，城门在身后逐渐远去', end: '二人随队伍走远，明确切到同年另一地点', sound: '缓慢脚步与衣料摩擦声', narration: '一一二七年，宋徽宗、宋钦宗被俘北去，北宋灭亡。这就是靖康之变。', label: '1127年' },
    { seconds: 10, purpose: '交代南宋建立并收束事件顺序', start: '另切应天府官署内景，赵构站在官员面前', visual: '赵构走向主位转身面向官员，官员肃立行礼', camera: '中景固定机位，保持赵构与官员的空间关系清楚', end: '赵构面向官员站定，停留一秒结束', sound: '室内轻微脚步，最后安静收束', narration: '同年，赵构在应天府即位，史称南宋。记住：二帝被俘，北宋灭亡，南宋建立。', label: '南宋建立' },
  ],
};

test('ordinary questions never automatically request a video', () => {
  for (const text of ['靖康之耻', '视频是什么意思', '不要生成视频', '不用视频讲', '用视频讲讲靖康之耻', '给我做个视频', '生成一段30s的视频']) assert.equal(wantsLearningVideo(text), false, text);
  for (const text of ['/视频生成', '/视频生成 靖康之耻']) assert.equal(wantsLearningVideo(text), true, text);
  assert.equal(wantsLearningVideo('靖康之耻', '视频'), false);
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
  for (const field of ['continuity']) assert.throws(() => validateVideoBrief({ ...brief, [field]: '' }));
  for (const field of ['purpose', 'start', 'end', 'sound']) assert.throws(() => validateVideoBrief({ ...brief, scenes: brief.scenes.map(scene => ({ ...scene, [field]: '' })) }));
  assert.ok(prompt.length <= 3000);
  for (const scene of brief.scenes) for (const field of ['purpose', 'start', 'visual', 'camera', 'end', 'sound', 'narration']) assert.ok(prompt.includes(scene[field]), `missing ${field} in provider prompt`);
  for (const text of ['30秒', '480p', '16:9', '0—10秒', '10—20秒', '20—30秒', '二帝被俘']) assert.ok(prompt.includes(text));
  assert.throws(() => validateVideoBrief({ ...brief, scenes: brief.scenes.map(s => ({ ...s, seconds: 15 })) }));
  assert.throws(() => validateVideoBrief({ ...brief, scenes: brief.scenes.slice(0, 1) }));
  assert.throws(() => validateVideoBrief({ ...brief, scenes: brief.scenes.map(s => ({ ...s, narration: '字'.repeat(150) })) }));
  assert.throws(() => validateVideoBrief({ ...brief, scenes: brief.scenes.map(s => ({ ...s, narration: '过短的旁白。' })) }));
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
    assert.match(context.systemPrompt, /已加载技能：xiaozhi-video/);
    return calls === 1 ? '<learning-video>{}</learning-video>' : '<learning-video>' + JSON.stringify(brief) + '</learning-video>';
  } });
  assert.equal(calls, 2);
  assert.equal(result.brief.title, '靖康之耻');
  assert.equal(result.skill.name, 'xiaozhi-video');
  assert.match(result.skill.sha256, /^[a-f0-9]{64}$/);
  assert.match(result.prompt, /480p/);
  assert.deepEqual(session, before);
});
