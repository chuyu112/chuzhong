import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

test('chat returns before missing-image planning; backfill is authenticated and idempotent', { timeout: 20000 }, async () => {
  const root = fileURLToPath(new URL('..', import.meta.url)), dir = await mkdtemp(join(tmpdir(), 'image-api-'));
  const stub = join(dir, 'fetch.mjs'), cli = join(dir, 'fake-flova'), gate = join(dir, 'release'), submits = join(dir, 'submits');
  await writeFile(stub, `import {existsSync} from 'node:fs';import {setTimeout as delay} from 'node:timers/promises';const original=fetch;globalThis.fetch=async(input,options)=>{
    const url=new URL(input);if(url.hostname==='cdn.flova.tv')return new Response('image-bytes',{headers:{'content-type':'image/png'}});
    if(url.hostname!=='open.bigmodel.cn')throw new Error('Unexpected test request');
    const body=JSON.parse(options.body);let content='神经细胞通过离子运动产生的电信号传递信息。';
    if(JSON.stringify(body.messages[0]).includes('后台的学习图解设计师')){while(!existsSync(${JSON.stringify(gate)}))await delay(10);content=JSON.stringify({needed:true,prompt:'一张神经细胞的教学示意图，用箭头和标签解释离子跨膜运动与电信号，不含个人信息。'});}
    return new Response(JSON.stringify({choices:[{message:{role:'assistant',content}}]}),{headers:{'content-type':'application/json'}});
  };`);
  await writeFile(cli, `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(submits)},'submitted\\n');console.log(JSON.stringify({code:0,data:{status:'completed',terminal:true,assistant_messages:[{artifacts:[{media_type:'image',status:'success',resource_url:'https://cdn.flova.tv/test.png'}]}]}}));\n`, { mode: 0o755 });
  const child = spawn(process.execPath, ['--import', stub, 'server/index.mjs'], { cwd: root, env: { ...process.env, CUIYI_SOURCE_DIR: dir, EDU_DATA_DIR: dir, EDU_HOST: '127.0.0.1', EDU_PORT: '0', EDU_COOKIE_SECURE: 'false', GLM_API_KEY: 'test-only', GLM_API_URL: 'https://open.bigmodel.cn/api/paas/v4', FLOVA_IMAGE_PROJECT_ID: 'test-project', FLOVA_CLI_PATH: cli, LIBTV_VIDEO_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const base = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Startup timeout')), 10000); child.stdout.on('data', data => { const m = String(data).match(/http:\/\/127.0.0.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } }); });
    const register = async phone => { const r = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, password: 'TestPassword123' }) }); assert.equal(r.status, 201); return r.headers.get('set-cookie').split(';')[0]; };
    const cookie = await register('19900000084'), otherCookie = await register('19900000085');
    const headers = { cookie, 'content-type': 'application/json' };
    const response = await fetch(base + '/api/chat', { method: 'POST', headers, body: JSON.stringify({ text: '有人说眼神放电是生物电？', sessionId: 'bio', modelId: 'glm-5.3-flash' }), signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200); const chat = await response.json(); assert.ok(chat.imageJobId); assert.match(chat.text, /神经细胞/);
    await assert.rejects(readFile(submits));
    const url = base + `/api/sessions/bio/images/${chat.messageIndex}`;
    assert.equal((await fetch(url, { method: 'POST' })).status, 401);
    const data = JSON.stringify({ modelId: 'glm-5.3-flash' });
    assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, cookie: otherCookie }, body: data })).status, 400);
    const duplicate = await (await fetch(url, { method: 'POST', headers, body: data })).json(); assert.equal(duplicate.imageJob.id, chat.imageJobId);
    await writeFile(gate, 'ready');
    let job;
    for (let i = 0; i < 100; i++) { job = await (await fetch(base + `/api/image-jobs/${chat.imageJobId}`, { headers })).json(); if (job.status !== 'pending') break; await delay(20); }
    assert.equal(job.status, 'completed');
    const image = await fetch(base + job.imageUrl, { headers }); assert.equal(image.status, 200); assert.equal(await image.text(), 'image-bytes');
    assert.equal((await readFile(submits, 'utf8')).split('submitted').length - 1, 1);
    assert.equal((await fetch(base + `/api/image-jobs/${chat.imageJobId}`, { headers: { cookie: otherCookie } })).status, 404);
  } finally {
    await writeFile(gate, 'ready');
    if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
    await rm(dir, { recursive: true, force: true });
  }
});
