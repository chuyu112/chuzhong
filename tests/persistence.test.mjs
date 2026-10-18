import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));

async function boot(directory) {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, EDU_DATA_DIR: directory, EDU_PORT: '0', EDU_HOST: '127.0.0.1', EDU_ACCESS_TOKEN: '', CUIYI_SOURCE_DIR: path.join(directory, 'empty-source') }, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('server startup timeout')); }, 20000);
    child.stdout.on('data', value => { const match = String(value).match(/http:\/\/127.0.0.1:\d+/); if(match) { clearTimeout(timeout); resolve(match[0]); } });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`server exited ${code}`)); });
  });
  let cookie='';
  const request = async (route, data) => {
    const response = await fetch(url + route, { method: data === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', cookie }, body: data === undefined ? undefined : JSON.stringify(data) });
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, body: await response.json() };
  };
  const stop = () => new Promise(resolve => { if(child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
  return { request, stop };
}

test('practice support, profile and evidence survive server restart', { timeout: 45000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'zhixu-memory-test-'));
  let server;
  try {
    server = await boot(directory);
    await server.request('/api/auth/register',{phone:'19900000011',password:'TestPass123'});
    const initial = (await server.request('/api/learning')).body;
    assert.equal('answer' in initial.questions[0], false);
    assert.equal('solution' in initial.questions[0], false);
    assert.equal('hints' in initial.questions[0], false);
    await server.request('/api/profile', { displayName: '测试同学', preferences: '先用图解释', notes: ['家庭自述：喜欢几何'] });
    await server.request('/api/hints', { questionId: 'sample-1' });
    const assisted = await server.request('/api/attempts', { questionId: 'sample-1', answer: '2' });
    assert.equal(assisted.body.support, 'hint');
    const repeat = await server.request('/api/attempts', { questionId: 'sample-1', answer: '2' });
    assert.equal(repeat.body.support, 'solution');
    const zero = await server.request('/api/attempts', { questionId: 'sample-2', answer: 0 });
    assert.equal(zero.status, 201);
    assert.equal(zero.body.correct, false);
    await server.request('/api/appearance',{agentName:'星星',theme:'night',background:'grid',avatar:'',backgroundImage:'',voiceName:'',voiceRate:1.1});
    await server.stop();
    server = await boot(directory);
    await server.request('/api/auth/login',{phone:'19900000011',password:'TestPass123'});
    assert.equal((await server.request('/api/appearance')).body.theme,'night');
    assert.equal((await server.request('/api/appearance')).body.voiceRate,1.1);
    assert.equal((await server.request('/api/appearance')).body.agentName,'星星');
    const memory = (await server.request('/api/memory')).body;
    assert.equal(memory.profile.displayName, '测试同学');
    assert.equal(memory.profile.notes[0].source, '家庭手动记录');
    assert.equal(memory.topics.find(t => t.topic === '二次函数').assistedAttempts, 2);
    assert.equal(memory.topics.find(t => t.topic === '二次函数').independentQuestions, 0);
    assert.equal(memory.weaknesses.length, 0);
    assert.equal((await server.request('/api/export')).body.learning.attempts.length, 3);
  } finally { await server?.stop(); await rm(directory, { recursive: true, force: true }); }
});
