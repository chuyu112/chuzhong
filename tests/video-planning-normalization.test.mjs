import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildVideoPrompt, englishWords, inspectVideoBrief, validateVideoBrief } from '../server/video-prompt.mjs';
import { englishSubtitleCues } from '../server/video-subtitles.mjs';
import { planLearningVideo } from '../server/video-planner.mjs';
import { buildStudentMemory } from '../server/memory.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/english-roleplay.json', import.meta.url), 'utf8'));
const adaptive = JSON.parse(await readFile(new URL('./fixtures/english-roleplay-adaptive.json', import.meta.url), 'utf8'));
const raw = value => `<learning-video>${JSON.stringify(value)}</learning-video>`;
const inspectDraft = value => inspectVideoBrief(raw(value), { scheduleDraft: true });

test('planning repairs speech windows without changing dialogue, translations, meaning or actions', async () => {
  const draft = structuredClone(adaptive);
  for (const scene of draft.scenes) for (const line of scene.dialogue) { line.start = 0; line.end = scene.seconds; }
  const before = structuredClone(draft);
  assert.equal(inspectVideoBrief(raw(draft)).brief, null, 'saved scripts still require valid timings');
  let calls = 0;
  const result = await planLearningVideo({ session: { id: 'timing', messages: [] }, modelId: 'deepseek-v4-flash', environment: {}, memory: buildStudentMemory({ questions: [], attempts: [] }), runModelOverride: async () => { calls++; return raw(draft); } });
  assert.equal(calls, 1);
  assert.deepEqual(draft, before);
  assert.deepEqual(result.brief.chunks, adaptive.chunks);
  for (const [i, scene] of result.brief.scenes.entries()) for (const [j, line] of scene.dialogue.entries()) {
    for (const field of ['speaker', 'text', 'translation', 'focus', 'action']) assert.equal(line[field], adaptive.scenes[i].dialogue[j][field]);
  }
  assert.doesNotThrow(() => validateVideoBrief(result.brief));
  assert.ok(englishSubtitleCues(result.brief).every(cue => cue.start >= 0 && cue.end <= 30));
});

test('short responses and dense sixteen-word dialogues fit all three stages at natural rates', () => {
  for (let words = 2; words <= 16; words++) for (let turns = 2; turns <= Math.min(4, words); turns++) {
    const draft = structuredClone(fixture);
    const counts = [words - turns + 1, ...Array(turns - 1).fill(1)];
    const lines = counts.map((count, index) => ({ ...fixture.scenes[0].dialogue[0], speaker: index % 2 ? 'B' : 'A', text: Array(count).fill('Hello').join(' '), translation: '你好', start: 0, end: 99 }));
    draft.targetSentence = lines[0].text;
    draft.scenes[0].dialogue = structuredClone(lines);
    draft.scenes[1].dialogue = structuredClone(lines);
    draft.scenes[2].dialogue = lines.flatMap(line => englishWords(line.text).map(word => ({ ...line, text: word, focus: word })));
    draft.chunks = draft.scenes[2].dialogue.map(line => ({ ...fixture.chunks[0], phrase: line.text }));
    const result = inspectDraft(draft);
    assert.ok(result.brief, `${words} words / ${turns} turns: ${result.issue}`);
    for (const [i, scene] of result.brief.scenes.entries()) for (const line of scene.dialogue) {
      const duration = line.end - line.start, rate = englishWords(line.text).length * 60 / duration;
      if (i === 0) assert.ok(rate >= 139 && rate <= 181);
      else if (i === 1) assert.ok(rate >= 89 && rate <= 111);
      else assert.ok(duration >= 0.8 && duration <= 1.4);
    }
  }
});

test('normalization cannot hide changed translations, missing words or excessive dialogue length', () => {
  for (const mutate of [
    draft => draft.scenes[1].dialogue[0].translation = '另一句翻译',
    draft => draft.scenes[2].dialogue.pop(),
    draft => draft.chunks.pop(),
    draft => draft.scenes[0].dialogue[0].text = Array(17).fill('Hello').join(' '),
  ]) { const draft = structuredClone(fixture); mutate(draft); assert.equal(inspectDraft(draft).brief, null); }
});

test('new planning upgrades older rigid scripts instead of submitting them again', async () => {
  let calls = 0;
  const result = await planLearningVideo({ session: { id: 'old-contract', messages: [] }, modelId: 'deepseek-v4-flash', environment: {}, memory: buildStudentMemory({ questions: [], attempts: [] }), runModelOverride: async ({ context }) => {
    calls++;
    if (calls === 1) return raw(fixture);
    assert.match(JSON.stringify(context.messages), /teachingVersion:3/);
    return raw(adaptive);
  } });
  assert.equal(calls, 2);
  assert.equal(result.brief.teachingVersion, 3);
});

test('compact provider prompt retains every spoken line and physical action while subtitles retain Chinese', () => {
  const draft = structuredClone(fixture);
  draft.goal = '完整的中文教学目标'.repeat(10);
  draft.facts = ['语法与情景说明'.repeat(15)];
  for (const chunk of draft.chunks) chunk.usage = '此词在当前句中的中文含义和作用';
  const approved = inspectDraft(draft).brief;
  const prompt = buildVideoPrompt(approved);
  assert.ok(JSON.stringify(approved).length > 3000);
  assert.ok(prompt.length < 2300, `prompt has ${prompt.length} characters`);
  assert.doesNotMatch(prompt, /\d+\.\d{4,}/);
  for (const scene of approved.scenes) {
    for (const field of ['start', 'visual', 'camera', 'end', 'sound']) assert.ok(prompt.includes(scene[field]));
    for (const line of scene.dialogue) assert.ok(prompt.includes(line.text) && prompt.includes(line.action));
  }
  assert.ok(englishSubtitleCues(approved).some(cue => cue.usage === draft.chunks[0].usage));
  const oversized = structuredClone(approved);
  for (const scene of oversized.scenes) {
    scene.visual = '动作'.repeat(90);
    scene.start = scene.end = '场景'.repeat(40);
    for (const line of scene.dialogue) line.action = '必要动作'.repeat(20);
  }
  assert.throws(() => buildVideoPrompt(oversized), /最多3000字/);
});
