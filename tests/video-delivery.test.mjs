import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

test('video appears last, survives reload, streams ranges and respects student/family access', { timeout: 45000 }, async () => {
  const root = fileURLToPath(new URL('..', import.meta.url)), directory = await mkdtemp(path.join(tmpdir(), 'zhixu-video-delivery-'));
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, EDU_DATA_DIR: directory, EDU_PORT: '0', EDU_COOKIE_SECURE: 'false', LIBTV_VIDEO_ENABLED: 'true', LIBTV_CLI_PATH: '/nonexistent-test-cli', FLOVA_IMAGE_PROJECT_ID: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser, db;
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('startup timeout')), 10000);
      child.stdout.on('data', value => { const match = String(value).match(/http:\/\/127.0.0.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    });
    const sample = path.join(directory, 'sample.mp4');
    await promisify(execFile)(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x758b70:s=854x480:r=10:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', sample]);
    const mp4 = await readFile(sample), filename = createHash('sha256').update(mp4).digest('hex');
    db = new DatabaseSync(path.join(directory, 'education.sqlite'));
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.route('**/api/speech**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"isolated test"}' }));
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base);
    await page.locator('#auth-register-tab').click(); await page.locator('#auth-phone').fill('13760481026');
    await page.locator('#auth-password').fill('StudentPass123'); await page.locator('#auth-confirm').fill('StudentPass123'); await page.locator('#auth-submit').click(); await page.locator('#chat-welcome').waitFor();
    assert.equal((await (await page.request.get(base + '/api/config')).json()).videoGeneration, true);
    const user = (await (await page.request.get(base + '/api/auth/me')).json()).user;
    await mkdir(path.join(directory, 'videos', user.id), { recursive: true });
    await writeFile(path.join(directory, 'videos', user.id, filename), mp4);
    const session = { id: 'video-lesson', messages: [{ role: 'user', content: '靖康之耻' }, { role: 'assistant', content: '1127年，徽钦二帝被俘，北宋灭亡。' }] };
    const save = () => db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?)').run(`u:${user.id}:session:${session.id}`, JSON.stringify(session));
    save(); await page.evaluate(id => localStorage.setItem('zhixu-session-' + id, 'video-lesson'), user.id); await page.reload();
    let creates = 0, release; const ready = new Promise(resolve => release = resolve);
    assert.equal(await page.locator('.learning-video-button').count(), 0);
    assert.equal(await page.locator('#media-type option').filter({hasText:'视频'}).count(), 0);
    assert.equal((await page.request.post(base + '/api/sessions/video-lesson/videos/1', { data: {} })).status(), 410);
    await page.route('**/api/chat', async route => {
      assert.equal(route.request().postDataJSON().text, '/视频生成');
      creates++; session.messages.push({role:'user',content:'/视频生成'},{role:'assistant',content:'后台正在制作这个话题的视频。',videoCommand:{key:'test-command',anchor:1},videoJob:{id:'test-video-job',status:'pending'}}); save();
      await route.fulfill({ status:202, contentType:'application/json', body:JSON.stringify({sessionId:session.id,messageIndex:3,text:session.messages[3].content,videoJob:session.messages[3].videoJob}) });
    });
    await page.route('**/api/video-jobs/test-video-job', async route => { await ready; await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'completed', videoUrl: '/api/sessions/video-lesson/videos/3' }) }); });
    await page.locator('#chat-input').fill('/视频生成'); await page.locator('#send-chat').click();
    await page.locator('.video-generation-status').waitFor(); assert.equal(await page.locator('#send-chat').isEnabled(), true);
    session.messages[3].videoJob.status = 'completed'; session.messages[3].generatedVideoRef = { filename, mimeType: 'video/mp4' }; save(); release();
    const video = page.locator('.learning-video video'); await video.waitFor();
    await page.waitForFunction(() => document.querySelector('.learning-video video')?.readyState >= 1);
    assert.equal(await video.getAttribute('playsinline'), '');
    assert.equal(await page.locator('.message.assistant').last().evaluate(el => el.lastElementChild.classList.contains('learning-video')), true);
    await page.reload(); await video.waitFor(); assert.equal(creates, 1);
    assert.equal(await page.locator('.learning-video video').count(), 1);
    await page.screenshot({ path: path.join(root, 'artifacts/video-delivery-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 900 }); await page.screenshot({ path: path.join(root, 'artifacts/video-delivery-desktop.png') });
    const url = base + '/api/sessions/video-lesson/videos/3';
    const range = await page.request.get(url, { headers: { range: 'bytes=2-11' } });
    assert.equal(range.status(), 206); assert.deepEqual(await range.body(), mp4.subarray(2, 12));
    assert.equal((await page.request.get(url, { headers: { range: 'bytes=999999999-' } })).status(), 416);
    const saved = await (await page.request.get(base + '/api/sessions/video-lesson')).json();
    assert.ok(!('generatedVideoRef' in saved.messages[3]));
    assert.equal((await fetch(url)).status, 401);
    const other = await browser.newContext();
    const registration = await other.request.post(base + '/api/auth/register', { data: { phone: '19900000082', password: 'ParentPass123' } }); assert.equal(registration.status(), 201);
    assert.equal((await other.request.get(url)).status(), 404);
    assert.equal((await (await other.request.get(base + '/api/config')).json()).videoGeneration, false);
    assert.equal((await other.request.post(url, { data: {} })).status(), 410);
    for (const data of [{ text: '/视频生成' }, { text: '/视频生成 靖康之耻' }]) assert.equal((await other.request.post(base + '/api/chat', { data })).status(), 403);
    assert.equal(db.prepare("SELECT count(*) AS n FROM documents WHERE id LIKE 'u:%:video-job:%'").get().n, 0);
    const familyUrl = base + `/api/family/students/${user.id}/sessions/video-lesson/videos/3`;
    assert.equal((await other.request.get(familyUrl)).status(), 403);
    const invitation = await (await page.request.post(base + '/api/family/invite', { data: {} })).json();
    assert.equal((await other.request.post(base + '/api/family/link', { data: { code: invitation.code } })).status(), 200);
    assert.equal((await other.request.get(familyUrl, { headers: { range: 'bytes=0-9' } })).status(), 206);
    // Retry stays in ordinary chat. The original attachment resumes without
    // adding action buttons or duplicating the video on the retry receipt.
    delete session.messages[3].generatedVideoRef; session.messages[3].videoJob.status = 'failed'; save();
    await page.unroute('**/api/chat'); await page.unroute('**/api/video-jobs/test-video-job');
    let retried = false;
    await page.route('**/api/video-jobs/test-video-job', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(retried ? { status: 'completed', videoUrl: '/api/sessions/video-lesson/videos/3' } : { status: 'failed' }) }));
    await page.route('**/api/chat', async route => {
      assert.equal(route.request().postDataJSON().text, '换个模型再试一次'); retried = true;
      session.messages[3].videoJob.status = 'completed'; session.messages[3].generatedVideoRef = { filename, mimeType: 'video/mp4' }; save();
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sessionId: session.id, messageIndex: 5, text: '好，我换个模型整理脚本，再试一次。', resumedVideoJob: { id: 'test-video-job', status: 'pending' } }) });
    });
    await page.reload(); await page.getByText('这次视频没生成成功。你可以说“重试”，或“换个模型重试”。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /重试/ }).count(), 0);
    await page.screenshot({ path: path.join(root, 'artifacts/video-retry-conversation.png') });
    await page.locator('#chat-input').fill('换个模型再试一次'); await page.locator('#send-chat').click();
    await video.waitFor(); assert.equal(await video.count(), 1);
    assert.equal(await page.locator('.message.assistant').last().locator('video').count(), 0);
    assert.equal(await page.locator('.video-generation-status.error').count(), 0);
    assert.deepEqual(errors, []); await other.close();
  } finally {
    await browser?.close(); db?.close();
    if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
    await rm(directory, { recursive: true, force: true });
  }
});
