import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVideoJobs } from '../server/video-jobs.mjs';
import { parseVideoRetry, replyToVideoRetry } from '../server/video-retry.mjs';

const models = [{ id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', configured: true }, { id: 'glm-5.3-flash', label: 'GLM-5.3-Flash', configured: true }];
function fixture({ provider = {}, plan, canGenerate } = {}) {
  const docs = new Map(), read = (key, fallback) => structuredClone(docs.get(key) ?? fallback), write = (key, value) => docs.set(key, structuredClone(value));
  const job = { id: 'job', userId: 'alice', sessionId: 'lesson', messageIndex: 2, modelId: models[0].id, status: 'failed', failureStage: 'planning', error: 'failed' };
  const session = { id: 'lesson', messages: [{ role: 'user', content: '心脏怎样跳动' }, { role: 'user', content: '/视频生成' }, { role: 'assistant', content: '视频回执', videoCommand: { key: 'command', anchor: 0 }, videoJob: { id: 'job', status: 'failed' }, videoError: 'failed' }] };
  write('u:alice:session:lesson', session); write('u:alice:video-job:job', job);
  const jobs = createVideoJobs({ read, write, data: '/unused', provider: { configured: true, createProject: async () => 'p', createNode: async () => 'n', submit: async () => {}, inspect: async () => ({ status: 'pending' }), ...provider }, plan: plan || (async () => ({ prompt: '安全的教学提示词', brief: { title: '心脏' } })), canGenerate, pollMs: 1, waitMs: 4 });
  return { jobs, read, write, job, session, args: { session, userId: 'alice', agentName: '小直', models, jobs, load: () => read('u:alice:session:lesson'), save: value => write('u:alice:session:lesson', value) } };
}

test('conversational retry phrases do not mistake questions or negation for authorization', () => {
  for (const text of ['重试', '请再试一次', '请帮我重试一下', '视频没生成，重试一下', '重新生成这个视频']) assert.equal(parseVideoRetry(text, models).changeModel, false, text);
  for (const text of ['换个模型重试', '换个模型再试一次', '帮我换模型试试', '用另一个模型重试']) assert.equal(parseVideoRetry(text, models).changeModel, true, text);
  assert.equal(parseVideoRetry('用GLM重试', models).modelId, models[1].id);
  assert.equal(parseVideoRetry('换成GLM-5.3-Flash重试', models).modelId, models[1].id);
  for (const text of ['不要重试', '换个模型重试是什么意思', '我不想重新生成视频', '再讲一次这道数学题', '生物电能生成视频吗']) assert.equal(parseVideoRetry(text, models), null, text);
});

test('retry changes the planning model on the same task and concurrent retries submit only once', async () => {
  const planned = []; let submits = 0;
  const f = fixture({ plan: async (_, job) => { planned.push(job.modelId); await delay(3); return { prompt: '正确的脚本', brief: { title: '心脏' } }; }, provider: { submit: async () => { submits++; } } });
  const [a, b] = await Promise.all([f.jobs.retry('alice', 'job', models[1].id), f.jobs.retry('alice', 'job', models[1].id)]);
  assert.equal(a.videoJob.id, 'job'); assert.equal(b.videoJob.id, 'job');
  await delay(25);
  assert.deepEqual(planned, [models[1].id]); assert.equal(submits, 1);
  assert.equal(f.jobs.get('alice', 'job').attempts.length, 1);
  assert.equal(f.read('u:alice:session:lesson').messages[2].videoError, undefined);
});

test('an uncertain remote result never creates a new paid task; completed remote video is recovered', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-retry-'));
  try {
    const f = fixture(); f.job.submittedAt = Date.now(); f.job.projectId = 'p'; f.job.nodeId = 'n'; f.job.prompt = 'existing'; f.write('u:alice:video-job:job', f.job);
    let mode = 'unknown', downloads = 0;
    const jobs = createVideoJobs({ read: f.read, write: f.write, data: directory, plan: async () => assert.fail('do not replan'), provider: {
      configured: true, createNode: async () => assert.fail('no new node'), submit: async () => assert.fail('no resubmission'),
      inspect: async () => { if (mode === 'unknown') throw new Error('network'); return { status: mode }; },
      download: async () => { downloads++; return { buffer: Buffer.from('mp4'), width: 854, height: 480, duration: 30 }; },
    }, pollMs: 1, waitMs: 5 });
    await assert.rejects(jobs.retry('alice', 'job', models[1].id), { status: 409 });
    assert.equal(jobs.get('alice', 'job').status, 'failed');
    mode = 'completed'; await jobs.retry('alice', 'job', models[1].id);
    await delay(15); assert.equal(jobs.get('alice', 'job').status, 'completed'); assert.equal(downloads, 1);
    assert.equal((await jobs.retry('alice', 'job', models[1].id)).videoJob.status, 'completed'); assert.equal(downloads, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a confirmed provider failure allows one explicit new attempt and preserves the audit trail', async () => {
  let creates = 0, submits = 0;
  const f = fixture({ provider: { inspect: async (_, node) => ({ status: node === 'old' ? 'failed' : 'pending' }), createNode: async () => { creates++; return 'new'; }, submit: async () => { submits++; } } });
  Object.assign(f.job, { projectId: 'p', nodeId: 'old', submittedAt: 123 }); f.write('u:alice:video-job:job', f.job);
  await f.jobs.retry('alice', 'job', models[1].id); await delay(20);
  const job = f.jobs.get('alice', 'job'); assert.equal(creates, 1); assert.equal(submits, 1); assert.equal(job.attempts[0].nodeId, 'old'); assert.equal(job.nodeId, 'new');
});

test('audio mismatch requires explicit retry before one new generation; recognizer outages recover existing media', async () => {
  for (const code of ['VIDEO_SPEECH_ALIGNMENT_FAILED', 'VIDEO_SPEECH_RECOGNITION_FAILED']) {
    let creates = 0, submits = 0, downloads = 0;
    const f = fixture({ provider: {
      inspect: async (_, node) => ({ status: node === 'old' ? 'completed' : 'pending' }),
      createNode: async () => { creates++; return 'new'; },
      submit: async () => { submits++; },
      download: async () => { downloads++; throw Object.assign(new Error('still unavailable'), { code }); },
    } });
    Object.assign(f.job, { projectId: 'p', nodeId: 'old', submittedAt: 123, prompt: 'approved', failureCode: code });
    f.write('u:alice:video-job:job', f.job);
    f.jobs.recover([{ body: JSON.stringify(f.job) }]);
    await delay(10);
    assert.equal(submits, 0, 'failed tasks never auto-regenerate');
    await f.jobs.retry('alice', 'job', models[1].id);
    await delay(20);
    if (code === 'VIDEO_SPEECH_ALIGNMENT_FAILED') {
      assert.equal(creates, 1); assert.equal(submits, 1); assert.equal(downloads, 0);
      assert.equal(f.jobs.get('alice', 'job').attempts[0].failureCode, code);
    } else {
      assert.equal(creates, 0); assert.equal(submits, 0); assert.equal(downloads, 1);
      assert.equal(f.jobs.get('alice', 'job').failureStage, 'speech_alignment');
    }
  }
});

test('retry permissions and slash-command origin remain mandatory', async () => {
  const blocked = fixture({ canGenerate: () => false });
  await assert.rejects(blocked.jobs.retry('alice', 'job', models[0].id), { status: 403 });
  const f = fixture(); await assert.rejects(f.jobs.retry('bob', 'job', models[0].id), { status: 404 });
  delete f.session.messages[2].videoCommand; f.write('u:alice:session:lesson', f.session);
  await assert.rejects(f.jobs.retry('alice', 'job', models[0].id), { status: 400 });
});

test('chat retry gives a natural receipt, merges media updates and keeps the original video attachment', async () => {
  const f = fixture();
  const result = await replyToVideoRetry({ ...f.args, text: '换个模型再试一次' });
  assert.match(result.text, /GLM/); assert.equal(result.resumedVideoJob.id, 'job');
  const saved = f.read('u:alice:session:lesson');
  assert.equal(saved.messages.at(-2).content, '换个模型再试一次');
  assert.equal(saved.messages.at(-1).videoRetry.jobId, 'job'); assert.equal(saved.messages.at(-1).videoJob, undefined);
  assert.equal(saved.messages[2].videoJob.status, 'pending');
  assert.equal(saved.messages[2].videoError, undefined); await delay(15);
});

test('ambiguous retry after a new topic does not act on an old video; explicit video wording can identify it', async () => {
  const f = fixture(); f.session.messages.push({ role: 'user', content: '再做这道方程' }, { role: 'assistant', content: '试试移项' }); f.write('u:alice:session:lesson', f.session);
  assert.equal(await replyToVideoRetry({ ...f.args, text: '重试' }), null);
  assert.equal(f.jobs.get('alice', 'job').status, 'failed');
  assert.ok((await replyToVideoRetry({ ...f.args, text: '视频重试' })).resumedVideoJob); await delay(15);
});
