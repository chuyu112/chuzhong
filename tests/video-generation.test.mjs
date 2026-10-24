import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createVideoGenerationService, videoNodeState, validateVideoMetadata } from '../server/video-generation.mjs';
import { createVideoJobs } from '../server/video-jobs.mjs';

test('LibTV submits exact text-video settings with argument arrays and no automatic retries', async () => {
  const calls = [];
  const provider = createVideoGenerationService({ enabled: true, execImpl: async (file, args) => {
    calls.push(args);
    return { stdout: JSON.stringify(args[0] === 'project' ? { projectMeta: { uuid: 'project-1' } } : { nodeKey: 'node-1' }) };
  } });
  assert.equal(await provider.createProject('job-1'), 'project-1');
  assert.equal(await provider.createNode('project-1', 'job-1', '知识点 $(literal)'), 'node-1');
  await provider.submit('project-1', 'node-1');
  const args = calls[1];
  for (const setting of ['model=Wan 3.0', 'modeType=text2video', 'resolution=480P', 'duration=30', 'ratio=16:9', 'enableSound=on', 'count=1']) assert.ok(args.includes(setting));
  assert.equal(args[args.indexOf('--prompt') + 1], '知识点 $(literal)');
  assert.equal(calls.filter(a => a.includes('--run')).length, 1);
  await assert.rejects(provider.createNode('project-1', 'job-2', '字'.repeat(3001)));
  assert.equal(calls.length, 3, 'oversized prompts never reach the provider');
});

test('provider distinguishes failures and refuses incorrect duration, resolution, or silent results', () => {
  const node = { nodeKey: 'node', data: { type: 'video', url: ['old.mp4'], taskInfo: { status: 1, loading: true } } };
  assert.equal(videoNodeState(node).status, 'pending');
  node.data.taskInfo = { status: 3, loading: false };
  assert.equal(videoNodeState(node).status, 'failed');
  const good = { format: { duration: '30.00' }, streams: [{ codec_type: 'video', width: 854, height: 480 }, { codec_type: 'audio' }] };
  assert.equal(validateVideoMetadata(good).duration, 30);
  for (const bad of [{ ...good, format: { duration: '10' } }, { ...good, streams: [good.streams[0]] }, { ...good, streams: [{ codec_type: 'video', width: 1280, height: 720 }, good.streams[1]] }]) assert.throws(() => validateVideoMetadata(bad));
});

test('a stopped CLI can recover an existing task from provider progress without submitting again', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'video-provider-'));
  try {
    const credentialsPath = join(dir, 'credentials.json');
    await writeFile(credentialsPath, JSON.stringify({ usertoken: 'test-only-token', webid: 'test-web-id' }));
    const provider = createVideoGenerationService({ credentialsPath,
      execImpl: async (_, args) => { assert.ok(!args.includes('--run')); return { stdout: JSON.stringify({ nodeKey: 'node', data: { type: 'video', url: [], taskInfo: { taskId: 'task-1', status: 1, loading: true } } }) }; },
      fetchImpl: async (url, init) => {
        assert.equal(url, 'https://api.liblib.tv/api/task/generation/progress');
        assert.deepEqual(JSON.parse(init.body), { taskIds: ['task-1'] });
        assert.equal(init.redirect, 'error');
        return Response.json({ code: 0, data: { progresses: [{ taskId: 'task-1', status: 2, taskResult: JSON.stringify({ videos: [{ videoUrl: 'https://cdn.liblib.cloud/learning.mp4' }] }) }] } });
      },
    });
    assert.deepEqual(await provider.inspect('project', 'node'), { status: 'completed', url: 'https://cdn.liblib.cloud/learning.mp4' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('jobs are idempotent, private, durable and preserve messages added during generation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'video-jobs-'));
  const documents = new Map(), read = (key, fallback) => documents.has(key) ? structuredClone(documents.get(key)) : fallback;
  const write = (key, value) => documents.set(key, structuredClone(value));
  let submitted = 0, allowFinish = false;
  const provider = { configured: true, createProject: async () => 'project', createNode: async () => 'node', submit: async () => { submitted++; }, inspect: async () => ({ status: allowFinish ? 'completed' : 'pending' }), download: async () => ({ buffer: Buffer.from('test-mp4'), duration: 30, width: 854, height: 480 }) };
  const options = { read, write, provider, data: directory, pollMs: 1, waitMs: 20, plan: async () => ({ prompt: 'knowledge-only', brief: { title: '知识点' } }) };
  write('u:alice:session:one', { id: 'one', messages: [{ role: 'user', content: '知识点' }, { role: 'assistant', content: '讲解', videoCommand: { key: 'test-command', anchor: 0 } }] });
  try {
    let jobs = createVideoJobs(options);
    const job = jobs.enqueue('alice', 'one', 1, 'model');
    assert.equal(jobs.enqueue('alice', 'one', 1, 'model').id, job.id);
    assert.equal(jobs.get('bob', job.id), null);
    await delay(35);
    assert.equal(submitted, 1);
    assert.equal(jobs.get('alice', job.id).status, 'pending', 'slow tasks remain recoverable');
    const session = read('u:alice:session:one'); session.messages.push({ role: 'user', content: '继续追问' }); write('u:alice:session:one', session);
    jobs = createVideoJobs(options); allowFinish = true;
    jobs.recover([{ body: JSON.stringify(jobs.get('alice', job.id)) }]);
    for (let i = 0; i < 100 && jobs.get('alice', job.id).status === 'pending'; i++) await delay(2);
    const done = jobs.get('alice', job.id);
    assert.equal(done.status, 'completed'); assert.equal(submitted, 1);
    assert.equal(read('u:alice:session:one').messages.at(-1).content, '继续追问');
    assert.equal((await readFile(join(directory, 'videos', 'alice', done.ref.filename))).toString(), 'test-mp4');
    assert.equal(jobs.enqueue('alice', 'one', 1, 'model').id, job.id);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

 test('unauthorized accounts cannot enqueue or recover paid video jobs', () => {
  const blocked = { id: 'blocked-job', userId: 'other', status: 'pending' };
  let providerCalls = 0;
  const jobs = createVideoJobs({ canGenerate: () => false, read: () => blocked, write: () => { throw new Error('must not write'); }, provider: { configured: true, createProject: async () => { providerCalls++; } }, data: '/unused' });
  assert.throws(() => jobs.enqueue('other', 'lesson', 1, 'model'), { status: 403 });
  jobs.recover([{ body: JSON.stringify(blocked) }]);
  jobs.start('other', blocked.id);
  assert.equal(providerCalls, 0);
});

test('ordinary explanation messages cannot create a video even through the job manager', () => {
  const jobs=createVideoJobs({ read:()=>({messages:[{role:'assistant',content:'文字与配图'}]}), write:()=>{throw new Error('unexpected mutation');}, provider:{configured:true}, data:'/unused' });
  assert.throws(()=>jobs.enqueue('alice','lesson',0,'model'),{status:400});
});

test('planning failures retain their cause and cannot submit a paid video', async () => {
 for (const code of ['VIDEO_BRIEF_INVALID', 'VIDEO_SCRIPT_OUTPUT_LIMIT']) {
  const docs = new Map(), read = (key, fallback) => structuredClone(docs.get(key) ?? fallback), write = (key, value) => docs.set(key, structuredClone(value));
  write('u:alice:session:s', { id: 's', messages: [{ role: 'assistant', content: '任务回执', videoCommand: { key: 'command' } }] });
  let created = 0;
  const jobs = createVideoJobs({ read, write, data: '/unused', provider: { configured: true, createProject: async () => { created++; } }, plan: async () => { throw Object.assign(new Error('safe error'), { code, diagnostics: [{ attempt: 1, issue: 'safe diagnostic' }] }); } });
  const job = jobs.enqueue('alice', 's', 0, 'model'); await delay(10);
  const saved = jobs.get('alice', job.id);
  assert.equal(saved.failureStage, 'planning'); assert.equal(saved.failureCode, code);
  assert.ok(saved.failedAt); assert.equal(saved.diagnostics.length, 1); assert.equal(created, 0); assert.equal(saved.submittedAt, undefined);
  assert.match(read('u:alice:session:s').messages[0].videoError, /你可以说“重试”/);
  if (code === 'VIDEO_SCRIPT_OUTPUT_LIMIT') assert.match(saved.error, /脚本写到一半被截断/);
 }
});
