import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));

test('a delayed learning image opens from the explanation into the preview and survives reload', { timeout: 45000 }, async () => {
 const directory = await mkdtemp(path.join(tmpdir(), 'zhixu-image-delivery-'));
 const child = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, EDU_DATA_DIR: directory, EDU_PORT: '0', EDU_HOST: '127.0.0.1', EDU_COOKIE_SECURE: 'false', FLOVA_IMAGE_PROJECT_ID: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
 let browser, db;
 try {
  const base = await new Promise((resolve, reject) => {
   const timer = setTimeout(() => reject(new Error('startup timeout')), 15000);
   child.stdout.on('data', value => { const match = String(value).match(/http:\/\/127.0.0.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
  });
  db = new DatabaseSync(path.join(directory, 'education.sqlite'));
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { window.Audio = class { play() { return Promise.resolve(); } pause() {} }; });
  await page.route('**/api/speech', route => route.fulfill({ contentType: 'audio/mpeg', body: Buffer.from('test audio') }));
  await page.goto(base);
  await page.locator('#auth-register-tab').click();
  await page.locator('#auth-phone').fill('19900000071');
  await page.locator('#auth-password').fill('StudentPass123');
  await page.locator('#auth-confirm').fill('StudentPass123');
  await page.locator('#auth-submit').click();
  await page.locator('#chat-welcome').waitFor();
  const user = (await (await page.request.get(base + '/api/auth/me')).json()).user;
  const png = Buffer.from(await page.evaluate(() => {
   const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 650;
   const context = canvas.getContext('2d'); context.fillStyle = '#d9e8cc'; context.fillRect(0, 0, 900, 650);
   context.fillStyle = '#36552f'; context.font = '48px sans-serif'; context.fillText('Learning diagram', 140, 300);
   return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  const filename = createHash('sha256').update(png).digest('hex');
  await mkdir(path.join(directory, 'illustrations', user.id), { recursive: true });
  await writeFile(path.join(directory, 'illustrations', user.id, filename), png);
  let session, calls = 0, releaseImage;
  const imageReady = new Promise(resolve => releaseImage = resolve);
  const save = () => db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?)').run(`u:${user.id}:session:${session.id}`, JSON.stringify(session));
  await page.route('**/api/chat', async route => {
   calls++;
   const payload = route.request().postDataJSON(), text = '贞观之治的这一步，可以结合人物、措施与结果来理解。\n\n'.repeat(24);
   session = { id: payload.sessionId, messages: [{ role: 'user', content: payload.text }, { role: 'assistant', content: text, imageJob: { id: 'diagram-job', status: 'pending' } }] };
   save();
   await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sessionId: session.id, text, imageJobId: 'diagram-job' }) });
  });
  await page.route('**/api/image-jobs/diagram-job', async route => {
   await imageReady;
   await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'completed', imageUrl: `/api/sessions/${session.id}/images/1` }) });
  });
  await page.locator('#chat-input').fill('讲讲贞观之治');
  await page.locator('#send-chat').click();
  await page.locator('.image-generation-status').waitFor();
  await page.waitForFunction(() => { const messages = document.querySelector('#messages'); return messages.scrollHeight - messages.scrollTop - messages.clientHeight < 5; });
  session.messages[1].imageJob.status = 'completed';
  session.messages[1].generatedImageRef = { filename, mimeType: 'image/png' };
  save(); releaseImage();
  const loadedImage = () => page.waitForFunction(() => {
   const image = document.querySelector('#media-stage img'); return image?.complete && image.naturalWidth > 0;
  });
  await page.locator('.generated-media-link', { hasText: '查看图片' }).click();
  await loadedImage();
  await mkdir(path.join(root, 'artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'artifacts/image-delivery-mobile.png') });
  const afterText = () => page.locator('.message.assistant').last().evaluate(message => Boolean(message.querySelector('.message-content').compareDocumentPosition(message.querySelector('.generated-media-links')) & Node.DOCUMENT_POSITION_FOLLOWING));
  assert.equal(await afterText(), true, 'generated diagrams should follow the explanation');
  assert.equal(await page.locator('.message.assistant').last().evaluate(message => message.lastElementChild.classList.contains('generated-media-links')), true, 'the diagram should be the last part of the reply');
  const imageInView = () => page.waitForFunction(() => {
   const image = document.querySelector('#media-stage img').getBoundingClientRect(), viewport = document.querySelector('#media-stage').getBoundingClientRect();
   return image.top >= viewport.top - 2 && image.bottom <= viewport.bottom + 2;
  });
  await imageInView();
  await page.screenshot({ path: path.join(root, 'artifacts/image-delivery-mobile.png') });
  await page.reload(); await page.locator('.generated-media-link', { hasText: '查看图片' }).click(); await loadedImage(); await imageInView();
  assert.equal(await afterText(), true);
  assert.equal(await page.locator('.message.assistant').last().evaluate(message => message.lastElementChild.classList.contains('generated-media-links')), true);
  assert.equal(await page.locator('#media-stage img').count(), 1);
  assert.equal(calls, 1, 'restoring a diagram must not submit another generation');
  await page.setViewportSize({ width: 1440, height: 900 });
  await imageInView();
  await page.screenshot({ path: path.join(root, 'artifacts/image-delivery-desktop.png') });
  assert.deepEqual(errors, []);
 } finally {
  await browser?.close(); db?.close();
  if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
  await rm(directory, { recursive: true, force: true });
 }
});
