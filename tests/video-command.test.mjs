import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { parseVideoCommand, videoPlanningSession } from '../server/video-command.mjs';
import { wantsLearningVideo } from '../server/video-prompt.mjs';
import { loadXiaozhiVideoSkill } from '../server/video-skill.mjs';
import { tutorPolicy } from '../server/tutor.mjs';

test('video slash command is explicit, supports current/new topics and loads only the dedicated skill', () => {
  for (const text of ['/视频生成', '／视频生成', '/生成视频', '／生成视频。', '/生成视频 把刚才的话题做成一个视频', '/视频生成 把这个话题做成一个视频']) {
    assert.equal(parseVideoCommand(text).currentTopic, true); assert.equal(wantsLearningVideo(text), true);
  }
  assert.equal(parseVideoCommand('/视频生成 靖康之耻').currentTopic, false);
  assert.equal(parseVideoCommand('/生成视频 英语点餐').instruction, '英语点餐');
  for (const text of ['这个话题 /生成视频', '把刚才的话题做成一个视频\n/视频生成', '这个话题，／生成视频。']) {
    assert.equal(parseVideoCommand(text).currentTopic, true); assert.equal(wantsLearningVideo(text), true);
  }
  const pastedLesson = "A: That's a fair point.\nB: I hadn't thought of that.\n\n这个话题";
  assert.equal(parseVideoCommand(pastedLesson + ' /生成视频').instruction, pastedLesson);
  assert.equal(parseVideoCommand(pastedLesson + ' /生成视频').currentTopic, false);
  for (const text of ['请不要 /生成视频', '先别执行 /视频生成', '什么是 /生成视频', '示例： /生成视频', '输入 /生成视频', '“/生成视频”', '```\n/生成视频']) assert.equal(parseVideoCommand(text), null);
  for (const text of ['帮我/生成视频把刚才的话题做成视频', '请 /视频生成 这个话题', '这个话题/生成视频', '/生成视频这个话题', '小直，/生成视频一下']) {
    assert.equal(parseVideoCommand(text)?.currentTopic, true, text); assert.equal(wantsLearningVideo(text), true);
  }
  for (const [text, expected] of [['勾股/生成视频定理', '勾股定理'], ['英语点餐，/视频生成 要两袋番茄酱', '英语点餐， 要两袋番茄酱'], ['A: Hello.\n/生成视频\nB: Hi.', 'A: Hello.\n\nB: Hi.']]) assert.equal(parseVideoCommand(text)?.instruction, expected);
  for (const text of ['我不想/生成视频', '/生成视频先不要执行', 'https://example.com/生成视频', '如何使用“/生成视频”这个命令', '`/生成视频`放在哪里']) assert.equal(parseVideoCommand(text), null);
  for (const text of ['什么是/视频生成', '不要/视频生成', '/视频生成器', '“/视频生成”是什么意思', '不要/生成视频', '/生成视频是什么', '生成视频']) assert.equal(parseVideoCommand(text), null);
  const skill = loadXiaozhiVideoSkill();
  assert.equal(skill.name, 'xiaozhi-video'); assert.match(skill.sha256, /^[a-f0-9]{64}$/);
  assert.ok(tutorPolicy({ generateVideo: true }).includes(skill.instructions));
  assert.ok(!tutorPolicy().includes(skill.instructions));
  assert.throws(() => loadXiaozhiVideoSkill('/nonexistent-skill-directory'));
});

test('a bare command uses the lesson and skips legacy command corrections and receipts', () => {
  const lesson = [{ role: 'user', content: '我想再要一杯咖啡，用英语怎么说' }, { role: 'assistant', content: 'Could I have another coffee, please? another 表示再一个。' }];
  const session = { id: 'coffee', messages: [
    { role: 'assistant', kind: 'greeting', content: '你好' }, ...lesson,
    { role: 'user', content: '/生成视频' }, { role: 'assistant', content: '这条命令的写法不太对' },
    { role: 'user', content: '/视频生成' }, { role: 'assistant', videoCommand: { anchor: 2 }, content: '已收到' },
  ] };
  const original = structuredClone(session);
  assert.deepEqual(videoPlanningSession(session).messages, lesson);
  assert.deepEqual(session, original);
  const changed = { ...session, messages: [...session.messages, { role: 'user', content: '/生成视频 勾股定理' }] };
  assert.equal(videoPlanningSession(changed).messages.at(-1).content, '勾股定理');
  const followup = { ...session, messages: [...session.messages, { role: 'user', content: '把咖啡换成茶怎么说？' }, { role: 'assistant', content: 'Could I have another tea, please?' }, { role: 'user', content: '/生成视频' }] };
  assert.equal(videoPlanningSession(followup).messages.at(-1).content, 'Could I have another tea, please?');
  const branch = { ...session, messages: [...session.messages,
    { role: 'user', content: 'another是什么意思？' }, { role: 'assistant', content: 'another是再一个，这里是再要一杯。' },
    { role: 'user', content: '/生成视频' },
  ] };
  assert.deepEqual(videoPlanningSession(branch).messages.map(message => message.content), [
    ...lesson.map(message => message.content), 'another是什么意思？', 'another是再一个，这里是再要一杯。',
  ], 'retain the main lesson together with useful branches so the planner can synthesize them');
  const pasted = "A: I see your point.\nB: That's fair.\n这个话题";
  const inline = { ...session, messages: [...session.messages, { role: 'user', content: pasted + ' /生成视频' }, { role: 'assistant', content: '已经开始制作' }] };
  assert.equal(videoPlanningSession(inline).messages.at(-1).content, pasted, 'keep pasted dialogue and omit the command receipt');
  assert.ok(!videoPlanningSession(inline).messages.some(m => m.content === '已经开始制作'));
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
    assert.equal((await chat(other, { text: '/生成视频', sessionId: 'topic' })).status, 403);
    assert.equal((await chat(other, { text: '这个话题 /生成视频', sessionId: 'topic' })).status, 403);
    assert.equal((await chat(other, { text: '帮我/生成视频这个话题', sessionId: 'topic' })).status, 403);
    assert.equal((await chat(owner, { text: '/视频生成', sessionId: 'empty' })).status, 400);
    db = new DatabaseSync(join(directory, 'education.sqlite'));
    const session = { id: 'topic', hints: 1, messages: [{ role: 'user', content: '靖康之耻' }, { role: 'assistant', content: '1127年徽钦二帝被俘，北宋灭亡，同年赵构即位建立南宋。' }, { role: 'user', content: '/生成视频' }, { role: 'assistant', content: '旧版命令格式提示不应该成为视频主题' }] };
    db.prepare('INSERT INTO documents VALUES(?,?)').run(`u:${owner.user.id}:session:topic`, JSON.stringify(session));
    const response = await chat(owner, { text: '/生成视频', sessionId: 'topic' });
    assert.equal(response.status, 202);
    const result = await response.json(); assert.equal(result.videoJob.status, 'pending'); assert.equal(result.messageIndex, 5);
    const stored = JSON.parse(db.prepare('SELECT body FROM documents WHERE id=?').get(`u:${owner.user.id}:session:topic`).body);
    assert.equal(stored.messages[5].videoJob.id, result.videoJob.id); assert.equal(stored.messages[5].videoCommand.anchor, 1); assert.equal(stored.status, 'completed');
    const repeated = await (await chat(owner, { text: '/视频生成', sessionId: 'topic' })).json();
    assert.equal(repeated.resumedVideoJob.id, result.videoJob.id);
    const middle = await (await chat(owner, { text: '帮我/生成视频把刚才的话题做成视频', sessionId: 'topic' })).json();
    assert.equal(middle.resumedVideoJob.id, result.videoJob.id, 'moving the command must not create a second task');
    const oldButton=await fetch(base+'/api/sessions/topic/videos/1',{method:'POST',headers:{cookie:owner.cookie,'content-type':'application/json'},body:JSON.stringify({modelId:'glm-5.3-flash'})});
    assert.equal(oldButton.status,410);
    assert.equal(db.prepare("SELECT count(*) AS n FROM documents WHERE id LIKE 'u:%:video-job:%'").get().n, 1);
    assert.equal((await chat(owner, { text: '我叫小乐', sessionId: 'topic' })).status, 200);
    for (let i = 0; i < 100 && !requests.length; i++) await delay(20);
    assert.equal(requests.length, 1, 'one planning request; no duplicate paid task');
    const prompt = JSON.stringify(requests[0]);
    assert.match(prompt, /已加载技能：xiaozhi-video/); assert.match(prompt, /靖康之耻/);
    assert.ok(!prompt.includes('旧版命令格式提示不应该成为视频主题'));
    assert.ok(!prompt.includes('收到，我会把这个话题做成一段视频'));
    const failedSession = { id: 'failed-topic', messages: [{ role: 'user', content: '/视频生成 心脏' }, { role: 'assistant', content: '任务回执', videoCommand: { key: 'failed-command', anchor: -1 }, videoJob: { id: 'failed-job', status: 'failed' } }] };
    const failedJob = { id: 'failed-job', userId: owner.user.id, sessionId: 'failed-topic', messageIndex: 1, modelId: 'glm-5.3-flash', status: 'failed', failureStage: 'planning' };
    for (const [id, value] of [['session:failed-topic', failedSession], ['video-job:failed-job', failedJob]]) db.prepare('INSERT INTO documents VALUES(?,?)').run(`u:${owner.user.id}:${id}`, JSON.stringify(value));
    const retry = await chat(owner, { text: '重试', sessionId: 'failed-topic' }); assert.equal(retry.status, 200);
    const retryResult = await retry.json(); assert.equal(retryResult.resumedVideoJob.id, 'failed-job'); assert.match(retryResult.text, /再试一次/);
    const afterRetry = JSON.parse(db.prepare('SELECT body FROM documents WHERE id=?').get(`u:${owner.user.id}:session:failed-topic`).body);
    assert.equal(afterRetry.messages.at(-1).kind, 'video-retry'); assert.equal(afterRetry.messages[1].videoJob.status, 'pending');
    assert.equal(db.prepare("SELECT count(*) AS n FROM documents WHERE id LIKE 'u:%:video-job:%'").get().n, 2, 'retry reuses the seeded task');

    const repeatedSession = { id: 'repeat-failed', messages: [{ role: 'user', content: '/视频生成 心脏' }, { role: 'assistant', content: '旧任务回执', videoCommand: { key: createHash('sha256').update(JSON.stringify([-1, '心脏'])).digest('hex'), anchor: -1 }, videoJob: { id: 'repeat-job', status: 'failed' }, videoError: '旧的失败信息' }] };
    const repeatedJob = { ...failedJob, id: 'repeat-job', sessionId: repeatedSession.id, error: '旧的失败信息' };
    for (const [id, value] of [['session:repeat-failed', repeatedSession], ['video-job:repeat-job', repeatedJob]]) db.prepare('INSERT INTO documents VALUES(?,?)').run(`u:${owner.user.id}:${id}`, JSON.stringify(value));
    const repeatedFailed = await chat(owner, { text: '/生成视频 心脏', sessionId: repeatedSession.id });
    assert.equal(repeatedFailed.status, 202);
    const restarted = await repeatedFailed.json();
    assert.equal(restarted.resumedVideoJob?.id, 'repeat-job', 'the repeated command must retry the old failed task');
    assert.equal(restarted.resumedVideoJob.status, 'pending');
    assert.equal(restarted.videoJob, undefined, 'the new receipt must not duplicate the video attachment');
    const readRepeated = () => JSON.parse(db.prepare('SELECT body FROM documents WHERE id=?').get(`u:${owner.user.id}:session:repeat-failed`).body);
    assert.equal(readRepeated().messages[1].videoError, undefined);
    assert.equal(readRepeated().messages[1].videoJob.status, 'pending');
    assert.equal(readRepeated().messages.at(-1).videoRetry.jobId, 'repeat-job');
    assert.equal(readRepeated().messages.at(-2).content, '/生成视频 心脏');
    const stillPending = await (await chat(owner, { text: '/视频生成 心脏', sessionId: repeatedSession.id })).json();
    assert.equal(stillPending.resumedVideoJob.id, 'repeat-job');
    assert.equal(db.prepare("SELECT count(*) AS n FROM documents WHERE id LIKE 'u:%:video-job:%'").get().n, 3);
    assert.equal(JSON.parse(db.prepare('SELECT body FROM documents WHERE id=?').get(`u:${owner.user.id}:video-job:repeat-job`).body).attempts.length, 1);
    const pastedText = "A: I see your point.\nB: That's fair.\n这个话题 /生成视频";
    const pastedResponse = await chat(owner, { text: pastedText, sessionId: 'pasted-lesson' });
    assert.equal(pastedResponse.status, 202, 'a suffix command returns a real task, never a tutoring promise');
    const pastedResult = await pastedResponse.json();
    assert.equal(pastedResult.videoJob.status, 'pending');
    const pastedSaved = JSON.parse(db.prepare('SELECT body FROM documents WHERE id=?').get(`u:${owner.user.id}:session:pasted-lesson`).body);
    assert.equal(pastedSaved.messages[pastedResult.messageIndex].videoJob.id, pastedResult.videoJob.id);
    assert.equal(videoPlanningSession(pastedSaved).messages.at(-1).content, pastedText.replace(' /生成视频', ''));
    const pastedRepeat = await (await chat(owner, { text: pastedText, sessionId: 'pasted-lesson' })).json();
    assert.equal(pastedRepeat.resumedVideoJob.id, pastedResult.videoJob.id);
    const pastedMiddle = await (await chat(owner, { text: pastedText.replace(' /生成视频', '').replace('I see', 'I/生成视频 see'), sessionId: 'pasted-lesson' })).json();
    assert.equal(pastedMiddle.resumedVideoJob.id, pastedResult.videoJob.id, 'all surrounding dialogue survives command removal and deduplication');
    assert.equal(db.prepare("SELECT count(*) AS n FROM documents WHERE id LIKE 'u:%:video-job:%'").get().n, 4);
  } finally {
    if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
    model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
