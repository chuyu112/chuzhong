import { loadXiaozhiVideoSkill } from './video-skill.mjs';
import { parseVideoCommand } from './video-command.mjs';

export const VIDEO_SPEC = Object.freeze({ duration: 30, resolution: '480p', ratio: '16:9' });

// Explicit requests only: asking about a video or a historical topic is not consent to generate one.
export function wantsLearningVideo(text, media = '') {
  if (parseVideoCommand(text)) return true;
  if (media === '视频') return true;
  const value = String(text).replace(/\s+/g, '');
  if (/(不要|不用|别|不需要).{0,10}(视频|短片)/.test(value)) return false;
  return /(?:生成|制作|做|来|给我|想看).{0,12}(?:视频|短片)|用视频.{0,8}(?:讲|解释|演示)|(?:视频|短片).{0,8}(?:讲一下|讲讲|解释一下)/.test(value);
}

const videoSkill = loadXiaozhiVideoSkill();
export const VIDEO_DIRECTION = videoSkill.direction;
export const VIDEO_PROMPT_POLICY = videoSkill.instructions;
export const VIDEO_SKILL_INFO = Object.freeze({ name: videoSkill.name, sha256: videoSkill.sha256 });

function cleanString(value, max, optional = false) {
  if (optional && value == null) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max) throw new Error('视频说明格式不完整');
  return value.trim();
}

export function validateVideoBrief(value) {
  if (!value || !Array.isArray(value.facts) || value.facts.length < 1 || value.facts.length > 4 || !Array.isArray(value.scenes) || value.scenes.length !== 3) throw new Error('视频需要三个清楚的分镜');
  const brief = {
    title: cleanString(value.title, 60), goal: cleanString(value.goal, 120),
    facts: value.facts.map(fact => cleanString(fact, 120)),
    continuity: cleanString(value.continuity, 240),
    scenes: value.scenes.map(scene => {
      if (scene.seconds !== 10) throw new Error('视频时长需要合计30秒');
      if (typeof scene.narration !== 'string' || scene.narration.trim().length < 28) throw new Error('每段旁白需要28—45字，以完整讲清内容');
      return { seconds: 10, purpose: cleanString(scene.purpose, 50), start: cleanString(scene.start, 80), visual: cleanString(scene.visual, 180), camera: cleanString(scene.camera, 90), end: cleanString(scene.end, 80), sound: cleanString(scene.sound, 50), narration: cleanString(scene.narration, 45) };
    }),
  };
  if (brief.scenes.map(s => s.narration).join('').length > 130) throw new Error('视频旁白太长');
  return brief;
}

export function extractVideoBrief(raw) {
  const matches = [...String(raw).matchAll(/<learning-video>([\s\S]*?)<\/learning-video>/gi)];
  let brief = null;
  if (matches.length === 1 && matches[0][1].length < 14000) {
    try { brief = validateVideoBrief(JSON.parse(matches[0][1])); } catch { /* Never submit incomplete model metadata. */ }
  }
  return { brief, text: String(raw).replace(/<learning-video>[\s\S]*?(?:<\/learning-video>|$)/gi, '').trim() };
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
