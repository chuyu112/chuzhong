import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { validateVideoBrief, buildVideoPrompt } from '../server/video-prompt.mjs';
import { planLearningVideo } from '../server/video-planner.mjs';
import { englishSubtitleAss, englishSubtitleCues } from '../server/video-subtitles.mjs';
import { createVideoGenerationService } from '../server/video-generation.mjs';
import { buildStudentMemory } from '../server/memory.mjs';
import { createVideoJobs } from '../server/video-jobs.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { tutorPolicy } from '../server/tutor.mjs';

const brief = JSON.parse(await readFile(new URL('./fixtures/english-roleplay.json', import.meta.url), 'utf8'));
const exec = promisify(execFile);

test('English roleplay performs normally, repeats slowly, then explains every word including the response', () => {
  const approved = validateVideoBrief(brief), prompt = buildVideoPrompt(approved);
  assert.equal(approved.mode, 'english_roleplay'); assert.equal(approved.cast.length, 2);
  assert.ok(prompt.length <= 3000); assert.match(prompt, /两位英语母语/); assert.match(prompt, /90—110/);
  assert.match(prompt, /140—180/);
  assert.deepEqual(approved.scenes.map(scene => scene.stage), ['normal', 'slow', 'word_by_word']);
  assert.deepEqual(approved.scenes.map(scene => scene.seconds), [6, 9, 15]);
  assert.match(prompt, /【0—6秒】正常/); assert.match(prompt, /【6—15秒】慢速/); assert.match(prompt, /【15—30秒】逐词/);
  assert.equal(approved.chunks.length, 13);
  const captions = englishSubtitleCues(approved);
  for (const chunk of approved.chunks) assert.ok(captions.some(cue => cue.text === chunk.phrase && cue.meaning === chunk.meaning && cue.usage === chunk.usage));
  assert.doesNotMatch(prompt, /普通话画外旁白|全片无字幕|人物不额外开口/);
  for (const scene of approved.scenes) for (const line of scene.dialogue) { assert.ok(prompt.includes(line.text)); assert.ok(prompt.includes(line.action)); }
  for (const mutate of [
    value => value.cast.push({ ...value.cast[0], id: 'C' }),
    value => delete value.teachingVersion,
    value => value.scenes.reverse(),
    value => value.scenes[0].stage = 'slow',
    value => value.scenes[0].seconds = 10,
    value => value.chunks.pop(),
    value => value.chunks[0].phrase = 'Could I',
    value => value.chunks[0].usage = '',
    value => value.chunks[0].meaning = '',
    value => value.chunks.reverse(),
    value => value.scenes[2].dialogue[0].focus = '',
    value => value.scenes[1].dialogue[0].action = '',
    value => value.scenes[1].dialogue[0].speaker = 'B',
    value => delete value.scenes[0].dialogue[0].translation,
    value => value.scenes[0].dialogue[0].translation = 'English only',
    value => value.scenes[1].dialogue[0].translation = '请给我一杯咖啡。',
    value => value.scenes[1].dialogue[1].text = 'Sure. Have a seat.',
    value => value.scenes[1].dialogue[0].end = 4.5,
    value => value.scenes[0].dialogue[0].end = 2.6,
    value => value.scenes[0].dialogue[1].start = 1,
    value => value.scenes[0].dialogue.pop(),
    value => value.scenes[0].dialogue[0].text = 'Ketchup, please.',
    value => value.scenes[2].dialogue.pop(),
    value => value.scenes[2].dialogue[0].text = 'Ketchup, please.',
    value => value.scenes[2].dialogue[0].end = 0.8,
    value => value.scenes[0].dialogue[0].text = '请给我番茄酱',
    value => value.scenes[0].dialogue[0].text = 'Could I have 3 ketchup packets, please?',
    value => value.scenes[0].dialogue[0].text = '{\\pos(0,0)}Could I have',
  ]) { const invalid = structuredClone(brief); mutate(invalid); assert.throws(() => validateVideoBrief(invalid), undefined, mutate.toString()); }
});

test('word timing accepts exact decimal boundaries without floating point rejection', () => {
  const value = structuredClone(brief);
  value.scenes[2].dialogue.at(-1).end = 14.1; // 14.1 - 13.3 is slightly less than 0.8 in floating point.
  assert.doesNotThrow(() => validateVideoBrief(value));
});

test('ordinary English tutoring follows the same order and explains words in context', () => {
  const policy = tutorPolicy();
  assert.match(policy, /正常口语速度完整演一遍双人对话→慢速重演同一段对话→按原顺序一个词一个词分析/);
  assert.match(policy, /覆盖对话及回应的每个词/);
  assert.match(policy, /当前句中的中文意思及作用/);
  assert.match(policy, /不声称已经播放了音视频/);
});

test('English planner repairs missing visual teaching without applying Chinese narration limits', async () => {
  let calls = 0;
  const result = await planLearningVideo({ session: { messages: [{ role: 'user', content: '在麦当劳想多要几袋番茄酱怎么说？' }] }, environment: {}, modelId: 'glm-5.3-flash', memory: buildStudentMemory({ questions: [], attempts: [] }), runModelOverride: async ({ context }) => {
    calls++;
    assert.match(JSON.stringify(context.messages), /先正常口语速度完整演一遍，再慢速原样重演，最后一个词一个词分析/);
    if (calls === 1) { const invalid = structuredClone(brief); invalid.scenes[1].dialogue[0].action = ''; return '<learning-video>' + JSON.stringify(invalid) + '</learning-video>'; }
    assert.match(JSON.stringify(context.messages), /dialogue\[0\].action/);
    return '<learning-video>' + JSON.stringify(brief) + '</learning-video>';
  } });
  assert.equal(calls, 2); assert.equal(result.brief.mode, 'english_roleplay');
});

test('subtitles show Chinese throughout both performances and contextual explanations during word analysis', () => {
  const cues = englishSubtitleCues(brief), ass = englishSubtitleAss(brief);
  assert.equal(cues.length, 17); assert.equal(cues[2].start, 6.1); assert.equal(cues[4].start, 15.1);
  assert.equal(cues[0].text, brief.targetSentence); assert.equal(cues[2].text, brief.targetSentence);
  assert.ok(cues.slice(0, 4).every(cue => !cue.meaning && !cue.usage));
  for (const cue of cues.slice(0, 4)) {
    assert.match(cue.translation, /[\u3400-\u9fff]/u);
    assert.ok(ass.includes(cue.translation));
  }
  for (const [i, cue] of cues.slice(4).entries()) {
    assert.equal(cue.text, brief.chunks[i].phrase);
    assert.equal(cue.meaning, brief.chunks[i].meaning); assert.equal(cue.usage, brief.chunks[i].usage);
    assert.equal(cue.end, cues[i + 5]?.start ?? 30);
    assert.ok(ass.includes(`${cue.meaning} · ${cue.usage}`));
  }
  assert.match(ass, /0:00:06.10,0:00:11.50/);
  for (const cue of cues) assert.ok(ass.replace(/\{[^}]*\}/g, '').includes(cue.text));
});

test('word explanations cannot inject subtitle positioning or formatting commands', () => {
  const value = structuredClone(brief);
  value.chunks[0].meaning = '{\\pos(0,0)}'; value.chunks[0].usage = '请\\N换行\n';
  const ass = englishSubtitleAss(value);
  assert.ok(!ass.includes('{\\pos(0,0)}'));
  assert.ok(ass.includes('｛＼pos(0,0)｝'));
  assert.ok(!ass.includes('请\\N换行'));
});

test('already submitted legacy scripts can finish subtitles but cannot be submitted as new lessons', async () => {
  const legacy = JSON.parse(await readFile(new URL('./fixtures/english-roleplay-legacy.json', import.meta.url), 'utf8'));
  assert.throws(() => validateVideoBrief(legacy), /teachingVersion/);
  assert.throws(() => buildVideoPrompt(legacy), /teachingVersion/);
  const cues = englishSubtitleCues(legacy);
  assert.equal(cues.length, 8); assert.equal(cues[3].start, 10.3); assert.equal(cues[6].start, 20.2);
  assert.ok(englishSubtitleAss(legacy).includes(legacy.chunks[0].meaning));
  legacy.scenes[2].dialogue[0].translation = '请问，可以多给我几袋番茄酱吗？';
  assert.ok(englishSubtitleAss(legacy).includes(legacy.scenes[2].dialogue[0].translation));
});

test('previously submitted v2 scripts remain recoverable without new sentence translations', () => {
  const saved = structuredClone(brief);
  for (const scene of saved.scenes) for (const line of scene.dialogue) delete line.translation;
  assert.throws(() => validateVideoBrief(saved), /translation/);
  assert.doesNotThrow(() => englishSubtitleAss(saved));
});

test('an English task retains its script across restart so subtitles cannot disappear on recovery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'english-job-test-'));
  const documents = new Map(), read = (key, fallback) => structuredClone(documents.get(key) ?? fallback), write = (key, value) => documents.set(key, structuredClone(value));
  let completed = false, submissions = 0;
  const provider = { configured: true, createProject: async () => 'project', createNode: async () => 'node', submit: async () => { submissions++; }, inspect: async () => ({ status: completed ? 'completed' : 'pending' }), download: async (_, __, ___, savedBrief) => {
    assert.deepEqual(savedBrief, brief); return { buffer: Buffer.from('captioned-test-video'), duration: 30, width: 854, height: 480, subtitleLanguage: 'en' };
  } };
  const options = { data: directory, read, write, provider, plan: async () => ({ brief, prompt: buildVideoPrompt(brief) }), pollMs: 1, waitMs: 3 };
  write('u:alice:session:s', { id: 's', messages: [{ role: 'assistant', content: '视频回执', videoCommand: { key: 'slash-command' } }] });
  try {
    let jobs = createVideoJobs(options); const job = jobs.enqueue('alice', 's', 0, 'model'); await delay(15);
    assert.deepEqual(jobs.get('alice', job.id).brief, brief);
    jobs = createVideoJobs(options); completed = true; jobs.recover([{ body: JSON.stringify(jobs.get('alice', job.id)) }]); await delay(15);
    assert.equal(jobs.get('alice', job.id).status, 'completed'); assert.equal(jobs.get('alice', job.id).ref.subtitleLanguage, 'en'); assert.equal(submissions, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('provider downloads and burns English subtitles while preserving 30 seconds, 480p and audio', { timeout: 45000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'english-video-test-'));
  try {
    const input = join(directory, 'input.mp4');
    await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x657e83:s=854x480:r=12:d=30', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-pix_fmt', 'yuv420p', input]);
    const source = await readFile(input), calls = [];
    const provider = createVideoGenerationService({ execImpl: async (file, args, options) => {
      calls.push(file);
      const checkedArgs = [...args];
      if (file === 'ffmpeg') checkedArgs[checkedArgs.indexOf('-loglevel') + 1] = 'info';
      const result = await exec(file, checkedArgs, options);
      if (file === 'ffmpeg') assert.doesNotMatch(result.stderr, /Error opening font|Glyph .*not found|failed to find.*font/i);
      return result;
    }, fetchImpl: async () => new Response(source) });
    const result = await provider.download('project', 'node', 'https://cdn.liblib.cloud/test.mp4', brief);
    assert.equal(result.subtitleLanguage, 'en'); assert.equal(result.height, 480); assert.equal(result.width, 854); assert.ok(Math.abs(result.duration - 30) < 0.1); assert.equal(calls.filter(file => file === 'ffmpeg').length, 1);
    const output = join(directory, 'captioned.mp4'); await writeFile(output, result.buffer);
    await exec('ffmpeg', ['-v', 'error', '-y', '-ss', '23', '-i', output, '-frames:v', '1', fileURLToPath(new URL('../artifacts/english-subtitle-check.png', import.meta.url))]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
