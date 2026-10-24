import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { parseVideoCommand } from '../server/video-command.mjs';
import { wantsLearningVideo } from '../server/video-prompt.mjs';
import { loadXiaozhiVideoSkill } from '../server/video-skill.mjs';
import { tutorPolicy } from '../server/tutor.mjs';

test('video slash command is explicit, supports current/new topics and loads only the dedicated skill', () => {
  for (const text of ['/视频生成', '／视频生成', '/视频生成 把这个话题做成一个视频']) {
    assert.equal(parseVideoCommand(text).currentTopic, true); assert.equal(wantsLearningVideo(text), true);
  }
  assert.equal(parseVideoCommand('/视频生成 靖康之耻').currentTopic, false);
  for (const text of ['什么是/视频生成', '不要/视频生成', '/视频生成器', '“/视频生成”是什么意思']) assert.equal(parseVideoCommand(text), null);
  const skill = loadXiaozhiVideoSkill();
  assert.equal(skill.name, 'xiaozhi-video'); assert.match(skill.sha256, /^[a-f0-9]{64}$/);
  assert.ok(tutorPolicy({ generateVideo: true }).includes(skill.instructions));
  assert.ok(!tutorPolicy().includes(skill.instructions));
  assert.throws(() => loadXiaozhiVideoSkill('/nonexistent-skill-directory'));
});

test('slash command creates a durable background task, deduplicates and keeps chat usable', { timeout: 20000 }, async () => {
  const root = fileURLToPath(new URL('..', import.meta.url)), directory = await mkdtemp(join(tmpdir(), 'zhixu-video-command-'));
  const requests = [];
  const model = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    // Deliberately never finish planning: the chat command must still return.
  });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  // Keep the provider's production domain validation intact. Only this isolated
  // child process redirects its test-only HTTP request to our stalled model.
  const stub = join(directory, 'model-stub.mjs');
  await writeFile(stub, `const original=globalThis.fetch;globalThis.fetch=(input,options)=>{const url=new URL(input);if(url.hostname!=='open.bigmodel.cn')throw new Error('Unexpected test network');return original('http://127.0.0.1:${model.address().port}'+url.pathname,options);};`);
  const child = spawn(process.execPath, ['--import', stub, 'server/index.mjs'], { cwd: root, env: {
    ...process.env, CUIYI_SOURCE_DIR: directory, EDU_DATA_DIR: directory, EDU_PORT: '0', EDU_HOST: '127.0.0.1', EDU_COOKIE_SECURE: 'false',
    EDU_ADMIN_PHONE: '', GLM_API_KEY: 'test-only', GLM_API_URL: 'https://open.bigmodel.cn/api/paas/v4',
    LIBTV_VIDEO_ENABLED: 'true', LIBTV_CLI_PATH: '/nonexistent-test-cli', FLOVA_IMAGE_PROJECT_ID: '',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let db;
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('startup timeout')), 10000);
      child.stdout.on('data', value => { const m = String(value).match(/http:\/\/127.0.0.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } });
    });
    async function register(phone) {
      const response = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, password: 'TestPassword123' }) });
      assert.equal(response.status, 201);
      return { cookie: response.headers.get('set-cookie').split(';')[0], user: (await response.json()).user };
    }
    const owner = await register('13760481026'), other = await register('19900000083');
    const chat = (account, data) => fetch(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', cookie: account.cookie }, body: JSON.stringify({ modelId: 'glm-5.3-flash', ...data }), signal: AbortSignal.timeout(2500) });
    assert.equal((await chat(other, { text: '/视频生成', sessionId: 'topic' })).status, 403);
    assert.equal((await chat(owner, { text: '/视频生成', sessionId: 'empty' })).status, 400);
    db = new DatabaseSync(join(directory, 'education.sqlite'));
    const session = { id: 'topic', hints: 1, messages: [{ role: 'user', content: '靖康之耻' }, { role: 'assistant', content: '1127年徽钦二帝被俘，北宋灭亡，同年赵构即位建立南宋。' }] };
    db.prepare('INSERT INTO documents VALUES(?,?)').run(`u:${owner.user.id}:session:topic`, JSON.stringify(session));
    const response = await chat(owner, { text: '/视频生成 把这个话题做成一个视频', sessionId: 'topic' });
    assert.equal(response.status, 202);
    const result = await response.json(); assert.equal(result.videoJob.status, 'pending'); assert.equal(result.messageIndex, 3);
    const stored = JSON.parse(db.prepare('SELECT body FROM documents WHERE id=?').get(`u:${owner.user.id}:session:topic`).body);
    assert.equal(stored.messages[3].videoJob.id, result.videoJob.id); assert.equal(stored.status, 'completed');
    const repeated = await (await chat(owner, { text: '/视频生成', sessionId: 'topic' })).json();
    assert.equal(repeated.videoJob.id, result.videoJob.id);
    const oldButton=await fetch(base+'/api/sessions/topic/videos/1',{method:'POST',headers:{cookie:owner.cookie,'content-type':'application/json'},body:JSON.stringify({modelId:'glm-5.3-flash'})});
    assert.equal(oldButton.status,410);
    assert.equal(db.prepare("SELECT count(*) AS n FROM documents WHERE id LIKE 'u:%:video-job:%'").get().n, 1);
    assert.equal((await chat(owner, { text: '我叫小乐', sessionId: 'topic' })).status, 200);
    for (let i = 0; i < 100 && !requests.length; i++) await delay(20);
    assert.equal(requests.length, 1, 'one planning request; no duplicate paid task');
    const prompt = JSON.stringify(requests[0]);
    assert.match(prompt, /已加载技能：xiaozhi-video/); assert.match(prompt, /靖康之耻/);
    const failedSession = { id: 'failed-topic', messages: [{ role: 'user', content: '/视频生成 心脏' }, { role: 'assistant', content: '任务回执', videoCommand: { key: 'failed-command', anchor: -1 }, videoJob: { id: 'failed-job', status: 'failed' } }] };
    const failedJob = { id: 'failed-job', userId: owner.user.id, sessionId: 'failed-topic', messageIndex: 1, modelId: 'glm-5.3-flash', status: 'failed', failureStage: 'planning' };
    for (const [id, value] of [['session:failed-topic', failedSession], ['video-job:failed-job', failedJob]]) db.prepare('INSERT INTO documents VALUES(?,?)').run(`u:${owner.user.id}:${id}`, JSON.stringify(value));
    const retry = await chat(owner, { text: '重试', sessionId: 'failed-topic' }); assert.equal(retry.status, 200);
    const retryResult = await retry.json(); assert.equal(retryResult.resumedVideoJob.id, 'failed-job'); assert.match(retryResult.text, /再试一次/);
    const afterRetry = JSON.parse(db.prepare('SELECT body FROM documents WHERE id=?').get(`u:${owner.user.id}:session:failed-topic`).body);
    assert.equal(afterRetry.messages.at(-1).kind, 'video-retry'); assert.equal(afterRetry.messages[1].videoJob.status, 'pending');
    assert.equal(db.prepare("SELECT count(*) AS n FROM documents WHERE id LIKE 'u:%:video-job:%'").get().n, 2, 'retry reuses the seeded task');
  } finally {
    if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
    model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
