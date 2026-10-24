import { loadXiaozhiVideoSkill } from './video-skill.mjs';
import { parseVideoCommand } from './video-command.mjs';

export const VIDEO_SPEC = Object.freeze({ duration: 30, resolution: '480p', ratio: '16:9' });

// Explicit requests only: asking about a video or a historical topic is not consent to generate one.
export function wantsLearningVideo(text) {
  return Boolean(parseVideoCommand(text));
}

const videoSkill = loadXiaozhiVideoSkill();
export const VIDEO_DIRECTION = videoSkill.direction;
export const ENGLISH_VIDEO_DIRECTION = videoSkill.englishDirection;
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
  const mode = value.mode || 'knowledge';
  if (!['knowledge', 'english_roleplay'].includes(mode)) throw new Error('mode需要knowledge或english_roleplay');
  const english = mode === 'english_roleplay';
  const brief = {
    mode,
    title: cleanString(value.title, 60, false, 'title'), goal: cleanString(value.goal, 120, false, 'goal'),
    facts: value.facts.map((fact, i) => cleanString(fact, 120, false, `facts[${i}]`)),
    continuity: cleanString(value.continuity, 240, false, 'continuity'),
    scenes: value.scenes.map((scene, i) => {
      if (!scene || typeof scene !== 'object') throw new Error(`scenes[${i}]需要完整分镜`);
      if (scene.seconds !== 10) throw new Error('视频时长需要合计30秒');
      if (!english && (typeof scene.narration !== 'string' || scene.narration.trim().length < 40)) throw new Error(`scenes[${i}].narration有${typeof scene.narration === 'string' ? scene.narration.trim().length : 0}字，需要40—55字`);
      return { seconds: 10, ...Object.fromEntries(Object.entries({ purpose: 50, start: 80, visual: 180, camera: 90, end: 80, sound: 50, ...(!english ? { narration: 55 } : {}) }).map(([field, max]) => [field, cleanString(scene[field], max, false, `scenes[${i}].${field}`)])), ...(english ? { dialogue: validateDialogue(scene.dialogue, i) } : {}) };
    }),
  };
  if (english) validateEnglishTeaching(value, brief);
  else {
    const narrationLength = brief.scenes.map(s => s.narration).join('').length;
    if (narrationLength < 135 || narrationLength > 155) throw new Error(`全片旁白有${narrationLength}字，需要135—155字`);
  }
  return brief;
}

export const englishWords = text => String(text).match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) || [];
const comparable = text => String(text).toLowerCase().replace(/[^a-z0-9'’]+/g, ' ').trim();
function englishText(value, max, field) {
  const text = cleanString(value, max, false, field);
  if (!/^[A-Za-z0-9 ,.!?'’“”"():;—–-]+$/.test(text) || !englishWords(text).length) throw new Error(`${field}必须是英文台词，不含中文、换行或制作标记`);
  return text;
}
function validateDialogue(value, sceneIndex) {
  const field = `scenes[${sceneIndex}].dialogue`;
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) throw new Error(`${field}需要1—4句双人台词`);
  let previousEnd = 0;
  return value.map((line, index) => {
    const path = `${field}[${index}]`;
    if (!line || !['A', 'B'].includes(line.speaker)) throw new Error(`${path}.speaker只能是A或B`);
    if (!Number.isFinite(line.start) || !Number.isFinite(line.end) || line.start < previousEnd || line.end > 10 || line.end - line.start < 0.4) throw new Error(`${path}时间需在本镜0—10秒内、按顺序不重叠，单句至少0.4秒`);
    previousEnd = line.end;
    const text = englishText(line.text, 160, `${path}.text`), focus = cleanString(line.focus, 80, true, `${path}.focus`);
    if (focus && !comparable(text).includes(comparable(englishText(focus, 80, `${path}.focus`)))) throw new Error(`${path}.focus必须是本句英文中的片段`);
    if (englishWords(text).length > (line.end - line.start) * 2.2 + 1) throw new Error(`${path}台词过长，需给慢速发音留足时间`);
    return { speaker: line.speaker, start: line.start, end: line.end, text, focus, action: cleanString(line.action, 80, false, `${path}.action`) };
  });
}
function validateEnglishTeaching(value, brief) {
  brief.targetSentence = englishText(value.targetSentence, 160, 'targetSentence');
  if (!Array.isArray(value.cast) || value.cast.length !== 2 || new Set(value.cast.map(actor => actor?.id)).size !== 2) throw new Error('cast需要A、B两位外国真人角色');
  brief.cast = value.cast.map(actor => {
    if (!['A', 'B'].includes(actor?.id)) throw new Error('cast角色代号只能是A和B');
    return { id: actor.id, ...Object.fromEntries(Object.entries({ role: 40, appearance: 100, voice: 80 }).map(([field, max]) => [field, cleanString(actor[field], max, false, `cast.${actor.id}.${field}`)])) };
  });
  if (!Array.isArray(value.chunks) || value.chunks.length < 2 || value.chunks.length > 6) throw new Error('chunks需要2—6个目标句片段');
  brief.chunks = value.chunks.map((chunk, i) => ({ phrase: englishText(chunk?.phrase, 80, `chunks[${i}].phrase`), meaning: cleanString(chunk?.meaning, 60, false, `chunks[${i}].meaning`), action: cleanString(chunk?.action, 80, false, `chunks[${i}].action`) }));
  if (comparable(brief.chunks.map(c => c.phrase).join(' ')) !== comparable(brief.targetSentence)) throw new Error('chunks应按原句顺序完整拆解targetSentence，不能遗漏或增加单词');
  const teaching = brief.scenes.slice(0, 2).flatMap(scene => scene.dialogue), ending = brief.scenes[2].dialogue;
  for (const chunk of brief.chunks) if (!teaching.some(line => comparable(line.focus) === comparable(chunk.phrase))) throw new Error(`前两镜缺少短语“${chunk.phrase}”对应的focus台词与动作`);
  if (!ending.some(line => comparable(line.text) === comparable(brief.targetSentence)) || new Set(ending.map(line => line.speaker)).size !== 2) throw new Error('第三镜需要完整目标句及另一角色的回应');
  const wordCount = brief.scenes.flatMap(scene => scene.dialogue).reduce((sum, line) => sum + englishWords(line.text).length, 0);
  if (wordCount < 20 || wordCount > 50) throw new Error(`全片英文台词${wordCount}词，需要20—50词，为动作与慢速发音留时间`);
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
  const english = brief.mode === 'english_roleplay';
  const prompt = [
    english ? ENGLISH_VIDEO_DIRECTION : VIDEO_DIRECTION,
    `【本片主题】${brief.title}\n【学习目标】${brief.goal}\n【必须准确的事实】\n${brief.facts.map(f => '- ' + f).join('\n')}\n【人物与场景统一设定】${brief.continuity}`,
    ...(english ? [`【演员】${brief.cast.map(actor => `${actor.id}：${actor.role}；${actor.appearance}；${actor.voice}`).join('\n')}\n【完整目标句】${brief.targetSentence}\n【拆解】${brief.chunks.map(c => `${c.phrase}＝${c.meaning}`).join('；')}`] : []),
    ...brief.scenes.map((s, i) => `【${i * 10}—${(i + 1) * 10}秒】\n本段要说明：${s.purpose}\n起始状态：${s.start}\n动作与变化：${s.visual}\n摄影：${s.camera}\n结束与衔接：${s.end}\n环境声：${s.sound}\n` + (english ? s.dialogue.map(line => `${i * 10 + line.start}—${i * 10 + line.end}秒 ${line.speaker}说：“${line.text}”${line.focus ? `；重点词：${line.focus}` : ''}；对应动作：${line.action}`).join('\n') : `画外旁白（逐字使用）：“${s.narration}”`)),
    english ? '仅生成这一条完整真人双人英语短片，严格使用指定英文台词、时间与动作。字幕由服务器后期添加，模型输出干净画面。' : '仅生成这一条完整短片，不添加新事件、对白、结论或版本。人物场景按设定连续，时间顺序清楚。真人实拍电影质感，全程无字幕和任何画面文字。',
  ].join('\n\n');
  if (prompt.length > 3000) throw new Error('视频提示词超过Wan 3.0长度限制');
  return prompt;
}
