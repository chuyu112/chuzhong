import { loadXiaozhiVideoSkill } from './video-skill.mjs';
import { parseVideoCommand } from './video-command.mjs';

export const VIDEO_SPEC = Object.freeze({ duration: 30, resolution: '480p', ratio: '16:9' });

// Explicit requests only: asking about a video or a historical topic is not consent to generate one.
export function wantsLearningVideo(text) {
  return Boolean(parseVideoCommand(text));
}

const videoSkill = loadXiaozhiVideoSkill();
export const VIDEO_DIRECTION = videoSkill.direction;
export const VIDEO_PROMPT_POLICY = videoSkill.instructions;
export const VIDEO_SKILL_INFO = Object.freeze({ name: videoSkill.name, sha256: videoSkill.sha256 });

function cleanString(value, max, optional = false, field = '视频说明') {
  if (optional && value == null) return '';
  if (typeof value !== 'string' || (!optional && !value.trim())) throw new Error(`${field}需要非空文字`);
  if (value.length > max) throw new Error(`${field}有${value.length}字，最多${max}字`);
  return value.trim();
}

export function validateVideoBrief(value) {
  if (!value || !Array.isArray(value.facts) || value.facts.length < 1 || value.facts.length > 4) throw new Error('facts需要1—4项事实');
  if (!Array.isArray(value.scenes) || value.scenes.length !== 3) throw new Error('scenes需要三个分镜');
  const brief = {
    title: cleanString(value.title, 60, false, 'title'), goal: cleanString(value.goal, 120, false, 'goal'),
    facts: value.facts.map((fact, i) => cleanString(fact, 120, false, `facts[${i}]`)),
    continuity: cleanString(value.continuity, 240, false, 'continuity'),
    scenes: value.scenes.map((scene, i) => {
      if (!scene || typeof scene !== 'object') throw new Error(`scenes[${i}]需要完整分镜`);
      if (scene.seconds !== 10) throw new Error('视频时长需要合计30秒');
      if (typeof scene.narration !== 'string' || scene.narration.trim().length < 40) throw new Error(`scenes[${i}].narration有${typeof scene.narration === 'string' ? scene.narration.trim().length : 0}字，需要40—55字`);
      return { seconds: 10, ...Object.fromEntries(Object.entries({ purpose: 50, start: 80, visual: 180, camera: 90, end: 80, sound: 50, narration: 55 }).map(([field, max]) => [field, cleanString(scene[field], max, false, `scenes[${i}].${field}`)])) };
    }),
  };
  const narrationLength = brief.scenes.map(s => s.narration).join('').length;
  if (narrationLength < 135 || narrationLength > 155) throw new Error(`全片旁白有${narrationLength}字，需要135—155字`);
  return brief;
}

export function inspectVideoBrief(raw) {
  const matches = [...String(raw).matchAll(/<learning-video>([\s\S]*?)<\/learning-video>/gi)];
  if (matches.length !== 1) return { brief: null, issue: '需要且只允许一个完整的learning-video标记' };
  if (matches[0][1].length >= 14000) return { brief: null, issue: '分镜JSON过长，需要小于14000字' };
  let value;
  try { value = JSON.parse(matches[0][1]); } catch { return { brief: null, issue: 'learning-video内部不是合法JSON' }; }
  try { return { brief: validateVideoBrief(value), issue: '' }; }
  catch (error) { return { brief: null, issue: error.message }; }
}

export function extractVideoBrief(raw) {
  return { brief: inspectVideoBrief(raw).brief, text: String(raw).replace(/<learning-video>[\s\S]*?(?:<\/learning-video>|$)/gi, '').trim() };
}

export function buildVideoPrompt(input) {
  const brief = validateVideoBrief(input);
  const prompt = [
    VIDEO_DIRECTION,
    `【本片主题】${brief.title}\n【学习目标】${brief.goal}\n【必须准确的事实】\n${brief.facts.map(f => '- ' + f).join('\n')}\n【人物与场景统一设定】${brief.continuity}`,
    ...brief.scenes.map((s, i) => `【${i * 10}—${(i + 1) * 10}秒】\n本段要说明：${s.purpose}\n起始状态：${s.start}\n动作与变化：${s.visual}\n摄影：${s.camera}\n结束与衔接：${s.end}\n环境声：${s.sound}\n画外旁白（逐字使用）：“${s.narration}”`),
    '仅生成这一条完整短片，不添加新事件、对白、结论或版本。人物场景按设定连续，时间顺序清楚。真人实拍电影质感，全程无字幕和任何画面文字。',
  ].join('\n\n');
  if (prompt.length > 3000) throw new Error('视频提示词超过Wan 3.0长度限制');
  return prompt;
}
