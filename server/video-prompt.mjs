import { loadXiaozhiVideoSkill } from './video-skill.mjs';
import { parseVideoCommand } from './video-command.mjs';

export const VIDEO_SPEC = Object.freeze({ duration: 30, resolution: '480p', ratio: '16:9' });
export const VIDEO_BRIEF_MAX_CHARACTERS = 20000;

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

const ENGLISH_STAGES = ['normal', 'slow', 'word_by_word'];
const ENGLISH_SECONDS = [6, 9, 15];

export function validateVideoBrief(value, { allowLegacyEnglish = false } = {}) {
  if (!value || !Array.isArray(value.facts) || value.facts.length < 1 || value.facts.length > 4) throw new Error('facts需要1—4项事实');
  if (!Array.isArray(value.scenes) || value.scenes.length !== 3) throw new Error('scenes需要三个分镜');
  const mode = value.mode || 'knowledge';
  if (!['knowledge', 'english_roleplay'].includes(mode)) throw new Error('mode需要knowledge或english_roleplay');
  const english = mode === 'english_roleplay';
  // Only subtitle recovery may read scripts already submitted under the old contract.
  const legacy = english && allowLegacyEnglish && value.teachingVersion == null && value.scenes.every(scene => scene?.stage == null);
  if (english && !legacy && value.teachingVersion !== 2) throw new Error('英语分镜需要teachingVersion:2，按正常语速、慢速重演、逐词分析排序');
  const brief = {
    mode,
    ...(english && !legacy ? { teachingVersion: 2 } : {}),
    title: cleanString(value.title, 60, false, 'title'), goal: cleanString(value.goal, 120, false, 'goal'),
    facts: value.facts.map((fact, i) => cleanString(fact, 120, false, `facts[${i}]`)),
    continuity: cleanString(value.continuity, 240, false, 'continuity'),
    scenes: value.scenes.map((scene, i) => {
      if (!scene || typeof scene !== 'object') throw new Error(`scenes[${i}]需要完整分镜`);
      const seconds = english && !legacy ? ENGLISH_SECONDS[i] : 10;
      if (scene.seconds !== seconds) throw new Error(english && !legacy ? '英语三镜时长依次为6、9、15秒，合计30秒' : '视频时长需要合计30秒');
      if (english && !legacy && scene.stage !== ENGLISH_STAGES[i]) throw new Error('英语三镜stage依次为normal、slow、word_by_word：先正常完整对话，再慢速重演，最后逐词分析');
      if (!english && (typeof scene.narration !== 'string' || scene.narration.trim().length < 40)) throw new Error(`scenes[${i}].narration有${typeof scene.narration === 'string' ? scene.narration.trim().length : 0}字，需要40—55字`);
      return { seconds, ...(english && !legacy ? { stage: ENGLISH_STAGES[i] } : {}), ...Object.fromEntries(Object.entries({ purpose: 50, start: 80, visual: 180, camera: 90, end: 80, sound: 50, ...(!english ? { narration: 55 } : {}) }).map(([field, max]) => [field, cleanString(scene[field], max, false, `scenes[${i}].${field}`)])), ...(english ? { dialogue: validateDialogue(scene.dialogue, i, seconds, legacy ? '' : ENGLISH_STAGES[i]) } : {}) };
    }),
  };
  if (english) validateEnglishTeaching(value, brief, legacy, !allowLegacyEnglish);
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
function validateDialogue(value, sceneIndex, seconds, stage) {
  const field = `scenes[${sceneIndex}].dialogue`;
  const limit = stage === 'word_by_word' ? 16 : 4;
  if (!Array.isArray(value) || value.length < 1 || value.length > limit) throw new Error(`${field}需要1—${limit}句台词`);
  let previousEnd = 0;
  return value.map((line, index) => {
    const path = `${field}[${index}]`;
    if (!line || !['A', 'B'].includes(line.speaker)) throw new Error(`${path}.speaker只能是A或B`);
    const minimum = stage === 'word_by_word' ? 0.8 : 0.4;
    if (!Number.isFinite(line.start) || !Number.isFinite(line.end) || line.start < previousEnd || line.end > seconds || line.end - line.start + 1e-9 < minimum) throw new Error(`${path}时间需在本镜0—${seconds}秒内、按顺序不重叠，单句至少${minimum}秒`);
    previousEnd = line.end;
    const text = englishText(line.text, 160, `${path}.text`), focus = cleanString(line.focus, 80, true, `${path}.focus`);
    if (stage && /\d/.test(text)) throw new Error(`${path}.text中的数字须拼写为英文单词，保证发音和逐词分析完整`);
    if (focus && !comparable(text).includes(comparable(englishText(focus, 80, `${path}.focus`)))) throw new Error(`${path}.focus必须是本句英文中的片段`);
    const duration = line.end - line.start, count = englishWords(text).length;
    // A word's speech window must not include the pause used to study its meaning.
    if (stage === 'word_by_word' && duration > 1.4) throw new Error(`${path}单词发音时间过长，最多1.4秒；请自然读出，把观察动作和跟读停顿放在词间，不能拖音`);
    if (stage === 'normal' && (count > duration * 3.2 + 0.25 || count < duration * 2.2 - 0.25)) throw new Error(`${path}首演需使用正常口语速度，约140—180词/分钟`);
    if (stage === 'slow' && (count > duration * 2 + 0.25 || count < duration * 1.2 - 0.25)) throw new Error(`${path}慢速重演需约90—110词/分钟，不能拖音`);
    if (!stage && count > duration * 2.2 + 1) throw new Error(`${path}台词过长，需给慢速发音留足时间`);
    const translation = cleanString(line.translation, 80, true, `${path}.translation`);
    if (translation && !/[\u3400-\u9fff]/u.test(translation)) throw new Error(`${path}.translation须包含准确的中文翻译`);
    return { speaker: line.speaker, start: line.start, end: line.end, text, focus, action: cleanString(line.action, 80, false, `${path}.action`), ...(translation ? { translation } : {}) };
  });
}
function validateEnglishTeaching(value, brief, legacy, requireTranslations) {
  brief.targetSentence = englishText(value.targetSentence, 160, 'targetSentence');
  if (!Array.isArray(value.cast) || value.cast.length !== 2 || new Set(value.cast.map(actor => actor?.id)).size !== 2) throw new Error('cast需要A、B两位外国真人角色');
  brief.cast = value.cast.map(actor => {
    if (!['A', 'B'].includes(actor?.id)) throw new Error('cast角色代号只能是A和B');
    return { id: actor.id, ...Object.fromEntries(Object.entries({ role: 40, appearance: 100, voice: 80 }).map(([field, max]) => [field, cleanString(actor[field], max, false, `cast.${actor.id}.${field}`)])) };
  });
  if (!legacy) return validateEnglishSequence(value, brief, requireTranslations);
  if (!Array.isArray(value.chunks) || value.chunks.length < 2 || value.chunks.length > 6) throw new Error('chunks需要2—6个目标句片段');
  brief.chunks = value.chunks.map((chunk, i) => ({ phrase: englishText(chunk?.phrase, 80, `chunks[${i}].phrase`), meaning: cleanString(chunk?.meaning, 60, false, `chunks[${i}].meaning`), action: cleanString(chunk?.action, 80, false, `chunks[${i}].action`) }));
  if (comparable(brief.chunks.map(c => c.phrase).join(' ')) !== comparable(brief.targetSentence)) throw new Error('chunks应按原句顺序完整拆解targetSentence，不能遗漏或增加单词');
  const teaching = brief.scenes.slice(0, 2).flatMap(scene => scene.dialogue), ending = brief.scenes[2].dialogue;
  for (const chunk of brief.chunks) if (!teaching.some(line => comparable(line.focus) === comparable(chunk.phrase))) throw new Error(`前两镜缺少短语“${chunk.phrase}”对应的focus台词与动作`);
  if (!ending.some(line => comparable(line.text) === comparable(brief.targetSentence)) || new Set(ending.map(line => line.speaker)).size !== 2) throw new Error('第三镜需要完整目标句及另一角色的回应');
  const wordCount = brief.scenes.flatMap(scene => scene.dialogue).reduce((sum, line) => sum + englishWords(line.text).length, 0);
  if (wordCount < 20 || wordCount > 50) throw new Error(`全片英文台词${wordCount}词，需要20—50词，为动作与慢速发音留时间`);
}

function validateEnglishSequence(value, brief, requireTranslations) {
  const [normal, slow, analysis] = brief.scenes.map(scene => scene.dialogue);
  if (!normal.some(line => line.text === brief.targetSentence) || new Set(normal.map(line => line.speaker)).size !== 2) throw new Error('第一镜需要正常语速的完整目标句及另一角色的回应');
  if (normal.length !== slow.length || normal.some((line, i) => line.text !== slow[i].text || line.speaker !== slow[i].speaker)) throw new Error('第二镜须按相同角色、顺序和逐字台词慢速重演第一镜完整对话');
  if (requireTranslations && normal.some((line, i) => !line.translation || line.translation !== slow[i].translation)) throw new Error('正常和慢速对话每句都须有相同的中文translation，不能只有英文字幕');
  if (normal.some((line, i) => slow[i].end - slow[i].start < (line.end - line.start) * 1.25)) throw new Error('第二镜每句至少比首演多留25%的发音时间');
  const words = normal.flatMap(line => englishWords(line.text));
  if (words.length > 16) throw new Error(`首演完整对话有${words.length}词，最多16词；请缩短自然表达并同步重写重演和逐词分析`);
  if (!Array.isArray(value.chunks) || value.chunks.length !== words.length) throw new Error(`第一镜完整对话共${words.length}词，chunks却有${Array.isArray(value.chunks) ? value.chunks.length : 0}项。必须按这个序列逐项写chunks和第三镜dialogue（含另一人的回应和重复词）：${words.join(' | ')}。两者均须恰好${words.length}项，phrase、text、focus逐项等于对应词，保留中文意思和用法`);
  brief.chunks = value.chunks.map((chunk, i) => {
    const phrase = englishText(chunk?.phrase, 40, `chunks[${i}].phrase`);
    if (phrase !== words[i]) throw new Error(`chunks[${i}]须单独分析第${i + 1}个词“${words[i]}”，不能合并短语、遗漏或调序`);
    return { phrase, meaning: cleanString(chunk?.meaning, 12, false, `chunks[${i}].meaning`), usage: cleanString(chunk?.usage, 18, false, `chunks[${i}].usage`), action: cleanString(chunk?.action, 80, false, `chunks[${i}].action`) };
  });
  if (analysis.length !== words.length || analysis.some((line, i) => line.text !== words[i] || line.focus !== words[i])) throw new Error('第三镜须按对话顺序一个词一个词慢读，text和focus分别对应每个chunks.phrase');
}

// Draft timing is calculated separately from text and meaning. Saved/submitted
// scripts still go through the strict validator without any rescheduling.
function scheduleEnglishDraft(value) {
  if (value?.mode !== 'english_roleplay' || value.teachingVersion !== 2 || value.scenes?.length !== 3) return value;
  const copy = structuredClone(value);
  const normal = copy.scenes[0]?.dialogue;
  if (!Array.isArray(normal)) return value;
  const totalWords = normal.reduce((sum, line) => sum + englishWords(line?.text).length, 0);
  if (totalWords > 16) throw new Error(`完整对话有${totalWords}词，最多16词；请保留原意，缩成双方合计6—10词的自然短对话，并同步重写重演和逐词分析`);
  for (const [i, scene] of copy.scenes.entries()) {
    const lines = scene?.dialogue;
    if (scene?.stage !== ENGLISH_STAGES[i] || scene.seconds !== ENGLISH_SECONDS[i] || !Array.isArray(lines) || !lines.length || lines.length > (i === 2 ? 16 : 4)) return value;
    const counts = lines.map(line => englishWords(line?.text).length);
    if (counts.some(count => !count) || (i === 2 && counts.some(count => count !== 1))) return value;
    const budget = scene.seconds - 0.1 - (lines.length - 1) * 0.05;
    const durationsAt = unit => counts.map(count => i === 2 ? 0.9 : Math.max(0.4, count * unit));
    let unit = i === 0 ? 60 / 160 : 60 / 100;
    if (i < 2 && durationsAt(unit).reduce((a, b) => a + b, 0) > budget) {
      let low = i === 0 ? 60 / 180 : 60 / 110, high = unit;
      if (durationsAt(low).reduce((a, b) => a + b, 0) > budget) return value;
      for (let step = 0; step < 30; step++) {
        const middle = (low + high) / 2;
        if (durationsAt(middle).reduce((a, b) => a + b, 0) > budget) high = middle;
        else low = middle;
      }
      unit = low;
    }
    const durations = durationsAt(unit), speech = durations.reduce((a, b) => a + b, 0);
    const gap = lines.length > 1 ? Math.min(i === 2 ? 0.4 : 0.25, (scene.seconds - 0.1 - speech) / (lines.length - 1)) : 0;
    let cursor = 0.05;
    for (const [j, line] of lines.entries()) {
      line.start = Number(cursor.toFixed(3));
      line.end = Number((cursor + durations[j]).toFixed(3));
      cursor += durations[j] + gap;
    }
  }
  return copy;
}

export function inspectVideoBrief(raw, { scheduleDraft = false } = {}) {
  const matches = [...String(raw).matchAll(/<learning-video>([\s\S]*?)<\/learning-video>/gi)];
  if (matches.length !== 1) return { brief: null, issue: '需要且只允许一个完整的learning-video标记' };
  if (matches[0][1].length > VIDEO_BRIEF_MAX_CHARACTERS) return { brief: null, issue: `完整视频脚本最多${VIDEO_BRIEF_MAX_CHARACTERS}字` };
  let value;
  try { value = JSON.parse(matches[0][1]); } catch { return { brief: null, issue: 'learning-video内部不是合法JSON' }; }
  try { return { brief: validateVideoBrief(scheduleDraft ? scheduleEnglishDraft(value) : value), issue: '' }; }
  catch (error) { return { brief: null, issue: error.message }; }
}

export function extractVideoBrief(raw) {
  return { brief: inspectVideoBrief(raw).brief, text: String(raw).replace(/<learning-video>[\s\S]*?(?:<\/learning-video>|$)/gi, '').trim() };
}

export function buildVideoPrompt(input) {
  const brief = validateVideoBrief(input);
  if (brief.mode === 'english_roleplay') return buildEnglishPrompt(brief);
  const prompt = [
    VIDEO_DIRECTION,
    `【本片主题】${brief.title}\n【学习目标】${brief.goal}\n【必须准确的事实】\n${brief.facts.map(f => '- ' + f).join('\n')}\n【人物与场景统一设定】${brief.continuity}`,
    ...brief.scenes.map((s, i) => {
      const offset = brief.scenes.slice(0, i).reduce((sum, scene) => sum + scene.seconds, 0);
      return `【${offset}—${offset + s.seconds}秒】\n本段要说明：${s.purpose}\n起始状态：${s.start}\n动作与变化：${s.visual}\n摄影：${s.camera}\n结束与衔接：${s.end}\n环境声：${s.sound}\n画外旁白（逐字使用）：“${s.narration}”`;
    }),
    '仅生成这一条完整短片，不添加新事件、对白、结论或版本。人物场景按设定连续，时间顺序清楚。真人实拍电影质感，全程无字幕和任何画面文字。',
  ].join('\n\n');
  if (prompt.length > 3000) throw new Error('视频提示词超过Wan 3.0长度限制');
  return prompt;
}

function buildEnglishPrompt(brief) {
  // Translation, meaning and usage are retained in the saved brief and burned
  // into subtitles by the server. They are not spoken or drawn by the provider.
  const time = seconds => Number(seconds.toFixed(3));
  const prompt = [
    '30秒，480p，16:9，真人实拍。两位英语母语外国成年人，标准美式发音，固定外貌、服装、音色、左右站位和道具；自然光线、真实人体和物理动作，无动漫、卡通或CG塑料感。',
    '先正常语速140—180词/分钟完整对话，再慢速90—110词/分钟原样重演，最后按原顺序逐词读。严格按时间窗发音，停顿放在词间；不拉长元音，不逐音节拖读。口型同步，另一人倾听，不抢话，不增加或省略台词，无中文配音、第三人旁白或配乐。',
    '输出干净画面，底部25%留白，动作居中；不生成文字。服务器后期添加中英双语字幕及逐词中文词义和用法。',
    `主题：${brief.title}\n场景：${brief.continuity}`,
    ...brief.cast.map(actor => `${actor.id}：${actor.role}；${actor.appearance}；${actor.voice}`),
    ...brief.scenes.map((scene, i) => {
      const offset = [0, 6, 15][i];
      return `【${offset}—${offset + scene.seconds}秒】${['正常对话', '慢速原样重演，切回同一情境起点', '逐词，动作对应词义'][i]}\n起：${scene.start}\n动作：${scene.visual}\n镜头：${scene.camera}\n收：${scene.end}\n环境声：${scene.sound}\n` + scene.dialogue.map(line => `${time(offset + line.start)}—${time(offset + line.end)}秒 ${line.speaker}：“${line.text}”；${line.action}`).join('\n');
    }),
  ].join('\n');
  if (prompt.length > 3000) throw new Error(`视频制作提示词有${prompt.length}字，最多3000字；保留逐字台词与动作，把场景、服装和镜头说明改为短句，删除重复修饰`);
  return prompt;
}
