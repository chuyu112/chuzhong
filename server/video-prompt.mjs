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
  if (value?.mode === 'english_roleplay' && value.teachingVersion === 3) return validateAdaptiveEnglish(value);
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

function validateAdaptiveEnglish(value) {
  if (!Array.isArray(value.facts) || value.facts.length < 1 || value.facts.length > 4) throw new Error('facts需要1—4项事实');
  if (!Array.isArray(value.scenes) || value.scenes.length < 1 || value.scenes.length > 4) throw new Error('英语按内容安排1—4段，不固定重演或慢放');
  if (!Array.isArray(value.cast) || value.cast.length !== 2 || new Set(value.cast.map(actor => actor?.id)).size !== 2) throw new Error('cast需要A、B两位角色');
  const brief = { mode: 'english_roleplay', teachingVersion: 3, title: cleanString(value.title, 60, false, 'title'), goal: cleanString(value.goal, 180, false, 'goal'), facts: value.facts.map((fact, i) => cleanString(fact, 120, false, `facts[${i}]`)), continuity: cleanString(value.continuity, 240, false, 'continuity'), targetSentence: englishText(value.targetSentence, 300, 'targetSentence'), cast: value.cast.map(actor => {
    if (!['A', 'B'].includes(actor.id)) throw new Error('cast只能为A、B');
    return { id: actor.id, ...Object.fromEntries(Object.entries({ role: 40, appearance: 100, voice: 80 }).map(([field, max]) => [field, cleanString(actor[field], max, false, `cast.${actor.id}.${field}`)])) };
  }), chunks: (value.chunks || []).map((chunk, i) => ({ phrase: englishText(chunk.phrase, 100, `chunks[${i}].phrase`), meaning: cleanString(chunk.meaning, 24, false, `chunks[${i}].meaning`), usage: cleanString(chunk.usage, 30, false, `chunks[${i}].usage`), action: cleanString(chunk.action, 80, false, `chunks[${i}].action`) })) };
  if (brief.chunks.length > 8) throw new Error('只拆解必要的词或表达，chunks最多8项');
  let words = 0, estimated = 0;
  brief.scenes = value.scenes.map((scene, i) => {
    if (!scene || !['normal', 'breakdown', 'example'].includes(scene.stage) || (i === 0 ? scene.stage !== 'normal' : scene.stage === 'normal')) throw new Error('先完整演一次normal，随后按需要breakdown或新example，不重演整段对话');
    if (!Number.isFinite(scene.seconds) || scene.seconds <= 0 || scene.seconds > 30 || !Array.isArray(scene.dialogue) || !scene.dialogue.length || scene.dialogue.length > 8) throw new Error('每段需有效时长及1—8句英文');
    let previousEnd = 0;
    const dialogue = scene.dialogue.map((line, j) => {
      const label = `scenes[${i}].dialogue[${j}]`, text = englishText(line.text, 300, label + '.text'), count = englishWords(text).length;
      if (!['A', 'B'].includes(line.speaker) || /\d/.test(text)) throw new Error(label + '需明确A/B，数字写成英文');
      const delivery = line.delivery || 'natural';
      if (!['natural', 'clear'].includes(delivery) || (delivery === 'clear' && scene.stage !== 'breakdown')) throw new Error('clear仅用于需要强调的发音，不默认慢放');
      const duration = line.end - line.start;
      if (!Number.isFinite(line.start) || !Number.isFinite(line.end) || line.start < previousEnd || line.end > scene.seconds + .001 || duration < Math.max(.2, count * 60 / (delivery === 'clear' ? 150 : 170) - .01) || duration > count * 60 / (delivery === 'clear' ? 140 : 150) + .01) throw new Error(label + '按自然语速分配发音时间，不能赶读、拖音或把停顿算进发音');
      previousEnd = line.end; words += count; estimated += duration + .18;
      const translation = cleanString(line.translation, 140, false, label + '.translation');
      if (!/[\u3400-\u9fff]/u.test(translation)) throw new Error(label + '需要准确中文翻译');
      const focus = cleanString(line.focus || '', 100, true, label + '.focus');
      if (focus && !comparable(text).includes(comparable(focus))) throw new Error(label + '.focus应来自实际台词');
      if (scene.stage === 'breakdown' && focus && !brief.chunks.some(chunk => comparable(chunk.phrase) === comparable(focus))) throw new Error('拆解的focus需要对应释义与用法');
      return { speaker: line.speaker, text, translation, focus, delivery, start: line.start, end: line.end, action: cleanString(line.action, 80, false, label + '.action') };
    });
    return { stage: scene.stage, seconds: scene.seconds, ...Object.fromEntries(Object.entries({ purpose: 80, start: 80, visual: 180, camera: 90, end: 80, sound: 50 }).map(([field, max]) => [field, cleanString(scene[field], max, false, `scenes[${i}].${field}`)])), dialogue };
  });
  if (Math.abs(brief.scenes.reduce((sum, scene) => sum + scene.seconds, 0) - 30) > .01) throw new Error('按内容分配各段时间，总计30秒');
  const first = brief.scenes[0].dialogue;
  if (new Set(first.map(line => line.speaker)).size !== 2 || !first.some(line => comparable(line.text).includes(comparable(brief.targetSentence)))) throw new Error('首演须有双方完整交流，并完整包含目标句');
  for (const scene of brief.scenes.slice(1)) {
    if (scene.dialogue.map(line => comparable(line.text)).join(' ') === first.map(line => comparable(line.text)).join(' ')) throw new Error('不能把同一完整对话重复一遍填时间');
    if (scene.stage === 'example' && scene.dialogue.some(line => line.text === brief.targetSentence)) throw new Error('新例子必须改变具体情境或用法，不能照读原目标句');
  }
  if (estimated > 29.7) throw new Error(`内容按自然语速约${estimated.toFixed(1)}秒，超过30秒；保留关键语义后精简或减少扩展`);
  if (estimated < 26) throw new Error(`内容按自然语速仅约${estimated.toFixed(1)}秒；请补充贴近主线的新例子或必要解释，不重复、不拖慢、不留长空白`);
  brief.timingEstimate = { words, speechAndTurnSeconds: Number(estimated.toFixed(2)), totalSeconds: 30 };
  return brief;
}

function scheduleAdaptiveEnglish(value) {
  if (!Array.isArray(value.scenes) || value.scenes.length < 1 || value.scenes.length > 4) return value;
  const copy = structuredClone(value);
  let naturalRate = 160;
  const measure = () => copy.scenes.map(scene => !Array.isArray(scene.dialogue) || !scene.dialogue.length ? NaN : scene.dialogue.reduce((sum, line) => sum + Math.max(.25, englishWords(line.text).length * 60 / (line.delivery === 'clear' ? 145 : naturalRate)) + .18, .1));
  let needs = measure(), needed = needs.reduce((sum, n) => sum + n, 0);
  // A fuller exchange can use the upper end of normal conversational speed.
  // Never exceed 170 wpm or alter a deliberately clearer pronunciation.
  if (needed > 29.7) { naturalRate = 170; needs = measure(); needed = needs.reduce((sum, n) => sum + n, 0); }
  if (!Number.isFinite(needed)) return value;
  if (needed > 29.7) throw new Error(`按自然语速约${needed.toFixed(1)}秒，内容超过30秒；精简扩展并保留主线，不赶读`);
  if (needed < 26) throw new Error(`按自然语速仅约${needed.toFixed(1)}秒；请补新的相关例子或必要解释，不能重复、拖慢或留长空白`);
  const lineCount = copy.scenes.reduce((sum, scene) => sum + scene.dialogue.length, 0);
  const extraPerTurn = (30 - needed) / lineCount;
  let used = 0;
  copy.scenes.forEach((scene, i) => {
    scene.seconds = Number((i === copy.scenes.length - 1 ? 30 - used : needs[i] + extraPerTurn * scene.dialogue.length).toFixed(3)); used += scene.seconds;
    let cursor = .1;
    const gap = .18 + extraPerTurn;
    scene.dialogue.forEach(line => {
      line.start = Number(cursor.toFixed(3)); line.end = Number((cursor + Math.max(.25, englishWords(line.text).length * 60 / (line.delivery === 'clear' ? 145 : naturalRate))).toFixed(3)); cursor = line.end + gap;
    });
  });
  return copy;
}

export const englishWords = text => String(text).match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) || [];
const comparable = text => String(text).toLowerCase().replace(/[^a-z0-9'’]+/g, ' ').trim();

// Apply the current teaching sequence to new plans only. Already submitted
// v3 scripts must remain readable for download and audio-aligned captions.
export function validateEnglishReview(brief) {
  if (brief.mode !== 'english_roleplay') return;
  if (brief.scenes[1]?.stage !== 'breakdown') throw new Error('完整对话首演后，先用breakdown稍慢讲清要点并复述关键表达，再按余量加新例子');
  const original = brief.scenes[0].dialogue.map(line => comparable(line.text));
  const fromOriginal = line => original.some(text => (' ' + text + ' ').includes(' ' + comparable(line.text) + ' '));
  const reviews = brief.scenes.filter(scene => scene.stage === 'breakdown').flatMap(scene => scene.dialogue);
  if (reviews.some(line => line.delivery !== 'clear')) throw new Error('要点讲解与复述用delivery:clear，约145词/分钟，比首演稍慢，不拖音');
  const repeats = reviews.filter(line => line.focus && fromOriginal(line));
  if (!repeats.length) throw new Error('要点讲清后，把首演中的关键句或短语原样再说一次：独立一条clear台词，focus对应chunks释义，不重演整段对话');
  if (new Set(repeats.map(line => comparable(line.text))).size !== repeats.length) throw new Error('同一个要点只复述一次，不重复凑时长');
  for (const line of repeats) {
    const index = reviews.indexOf(line);
    if (!reviews.slice(0, index).some(explanation => explanation.focus && comparable(explanation.focus) === comparable(line.focus) && !fromOriginal(explanation))) throw new Error('先用简短英文和动作讲清要点，再复述；说明台词和复述台词使用同一个focus并对应中文释义');
  }
}
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
  if (value?.mode === 'english_roleplay' && value.teachingVersion === 3) return scheduleAdaptiveEnglish(value);
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
  if (brief.teachingVersion === 3) {
    let offset = 0;
    const prompt = [
      '30秒480p、16:9真人电影质感，两位英语母语外国成年人自然交流，标准美式发音。先正常语速完整演一遍双人对话，再稍慢讲清要点，把关键句或短语再说一次；内容短用不同的新例子扩展，不重复整段对话、不用拖音或长空白凑时长。',
      '正常台词约150—170词/分钟，有clear标记才略微清楚地读，约145词/分钟；绝不夸张慢放或拉长单词。口型与台词同步，未说话者倾听，无中文配音、第三人旁白或背景人声。',
      '按下列顺序逐字说出台词；干净画面，不生成字幕文字。底部25%供后期中英字幕；服务器会按实际音轨对齐。保持人物服装、音色、道具及站位连续，无动漫、卡通或赛璐璐。',
      `主题：${brief.title}\n目标：${brief.goal}\n统一设定：${brief.continuity}`,
      ...brief.cast.map(actor => `${actor.id}：${actor.role}；${actor.appearance}；${actor.voice}`),
      ...brief.scenes.map(scene => {
        const start = offset; offset += scene.seconds;
        return `【${start.toFixed(2)}—${offset.toFixed(2)}秒 ${scene.stage}】${scene.purpose}\n起：${scene.start}\n动作：${scene.visual}\n镜头：${scene.camera}\n收：${scene.end}\n` + scene.dialogue.map(line => `${(start + line.start).toFixed(2)}—${(start + line.end).toFixed(2)}秒 ${line.speaker}（${line.delivery === 'clear' ? '略清晰，不拖音' : '自然语速'}）：“${line.text}”；${line.action}`).join('\n');
      }),
    ].join('\n');
    if (prompt.length > 3000) throw new Error('制作提示词最多3000字，请精简镜头形容，不删关键台词');
    return prompt;
  }
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
