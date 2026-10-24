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

const brief = JSON.parse(await readFile(new URL('./fixtures/english-roleplay.json', import.meta.url), 'utf8'));
const exec = promisify(execFile);

test('English roleplay decomposes every phrase, maps words to action, and ends with both people speaking', () => {
  const approved = validateVideoBrief(brief), prompt = buildVideoPrompt(approved);
  assert.equal(approved.mode, 'english_roleplay'); assert.equal(approved.cast.length, 2);
  assert.ok(prompt.length <= 3000); assert.match(prompt, /两位英语母语/); assert.match(prompt, /90—110/);
  assert.doesNotMatch(prompt, /普通话画外旁白|全片无字幕|人物不额外开口/);
  for (const scene of approved.scenes) for (const line of scene.dialogue) { assert.ok(prompt.includes(line.text)); assert.ok(prompt.includes(line.action)); }
  for (const mutate of [
    value => value.cast.push({ ...value.cast[0], id: 'C' }),
    value => value.chunks.pop(),
    value => value.scenes[0].dialogue[0].focus = '',
    value => value.scenes[1].dialogue[0].action = '',
    value => value.scenes[0].dialogue[1].start = 1,
    value => value.scenes[2].dialogue.pop(),
    value => value.scenes[2].dialogue[0].text = 'Ketchup, please.',
    value => value.scenes[2].dialogue[0].end = 0.8,
    value => value.scenes[0].dialogue[0].text = '请给我番茄酱',
    value => value.scenes[0].dialogue[0].text = '{\\pos(0,0)}Could I have',
  ]) { const invalid = structuredClone(brief); mutate(invalid); assert.throws(() => validateVideoBrief(invalid)); }
});

test('English planner repairs missing visual teaching without applying Chinese narration limits', async () => {
  let calls = 0;
  const result = await planLearningVideo({ session: { messages: [{ role: 'user', content: '在麦当劳想多要几袋番茄酱怎么说？' }] }, environment: {}, modelId: 'glm-5.3-flash', memory: buildStudentMemory({ questions: [], attempts: [] }), runModelOverride: async ({ context }) => {
    calls++;
    if (calls === 1) { const invalid = structuredClone(brief); invalid.scenes[1].dialogue[0].action = ''; return '<learning-video>' + JSON.stringify(invalid) + '</learning-video>'; }
    assert.match(JSON.stringify(context.messages), /dialogue\[0\].action/);
    return '<learning-video>' + JSON.stringify(brief) + '</learning-video>';
  } });
  assert.equal(calls, 2); assert.equal(result.brief.mode, 'english_roleplay');
});

test('subtitles use the exact spoken English, correct scene offsets, and literal focus highlighting', () => {
  const cues = englishSubtitleCues(brief), ass = englishSubtitleAss(brief);
  assert.equal(cues.length, 8); assert.equal(cues[3].start, 10.3); assert.equal(cues[6].start, 20.2);
  assert.equal(cues[6].text, brief.targetSentence); assert.ok(!/[\u4e00-\u9fff]/.test(ass));
  assert.match(ass, /0:00:20.20,0:00:26.30/);
  for (const cue of cues) assert.ok(ass.replace(/\{[^}]*\}/g, '').includes(cue.text));
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
    const provider = createVideoGenerationService({ execImpl: async (file, args, options) => { calls.push(file); return exec(file, args, options); }, fetchImpl: async () => new Response(source) });
    const result = await provider.download('project', 'node', 'https://cdn.liblib.cloud/test.mp4', brief);
    assert.equal(result.subtitleLanguage, 'en'); assert.equal(result.height, 480); assert.equal(result.width, 854); assert.ok(Math.abs(result.duration - 30) < 0.1); assert.equal(calls.filter(file => file === 'ffmpeg').length, 1);
    const output = join(directory, 'captioned.mp4'); await writeFile(output, result.buffer);
    await exec('ffmpeg', ['-v', 'error', '-y', '-ss', '23', '-i', output, '-frames:v', '1', fileURLToPath(new URL('../artifacts/english-subtitle-check.png', import.meta.url))]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
