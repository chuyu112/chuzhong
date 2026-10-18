import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

test('random Doubao voices are used for legacy preferences; pause/resume reuses audio and never falls back', { timeout: 30000 }, async () => {
 const server = createServer((req, res) => {
  if (req.url === '/') { res.setHeader('content-type', 'text/html'); return res.end('<div class="speech-controls"><button id="read">朗读</button><button id="speech-stop" hidden>■</button></div>'); }
  if (!['/speech-player.js', '/core.js', '/voice-options.js'].includes(req.url)) { res.writeHead(404); return res.end(); }
  res.setHeader('content-type', 'text/javascript'); res.end(readFileSync(new URL('../dist' + req.url, import.meta.url)));
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const browser = await chromium.launch({ channel: 'chrome', headless: true });
 try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
   window.calls = { speak: 0, play: 0, pause: 0 }; window.audioItems = [];
   Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak() { calls.speak++; } } });
   window.Audio = class {
    constructor() { audioItems.push(this); }
    play() { calls.play++; if (window.blockAutoplay) { window.blockAutoplay = false; return Promise.reject(new DOMException('tap required', 'NotAllowedError')); } return Promise.resolve(); }
    pause() { calls.pause++; }
   };
  });
  const requests = []; let release, blocked = false, fail = false;
  await page.route('**/api/speech', async route => {
   requests.push(route.request().postDataJSON());
   if (blocked) await new Promise(resolve => release = resolve);
   await route.fulfill(fail ? { status: 502, contentType: 'application/json', body: JSON.stringify({ error: '豆包语音暂时无法播放，请稍后再试。' }) } : { contentType: 'audio/mpeg', body: Buffer.from('test audio') }).catch(() => {});
  });
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.evaluate(async () => {
   const { createSpeechPlayer } = await import('/speech-player.js');
   window.player = createSpeechPlayer({ toast: text => { window.lastToast = text; } });
   window.voice = { name: '', rate: 1 }; window.states = [];
   document.querySelector('#speech-stop').onclick = () => player.stop();
   document.querySelector('#read').onclick = () => player.toggle({ text: '先理解等式。朗读版：两边同时减去五。', voice, button: document.querySelector('#read'), stopButton: document.querySelector('#speech-stop'), onState: s => states.push(s) });
  });
  const read = page.locator('#read'), stop = page.locator('#speech-stop');
  await read.click(); await page.waitForFunction(() => states.at(-1) === 'playing');
  assert.equal(await stop.isVisible(), true);
  assert.deepEqual(requests[0], { text: '两边同时减去五。', voice: 'doubao:random', rate: 1 });
  await read.click(); assert.equal(await page.evaluate(() => states.at(-1)), 'paused');
  await read.click(); assert.equal(await page.evaluate(() => calls.play), 2); assert.equal(requests.length, 1);
  await stop.click(); assert.equal(await stop.isVisible(), false);
  await page.evaluate(() => voice.name = 'Microsoft Xiaoxiao Online'); blocked = true;
  await read.click(); await page.waitForFunction(() => states.at(-1) === 'loading'); assert.equal(await stop.isVisible(), false);
  while (!release) await new Promise(r => setTimeout(r, 10));
  await read.click(); assert.equal(await page.evaluate(() => states.at(-1)), 'idle');
  release(); blocked = false; await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => calls.play), 2); assert.equal(requests[1].voice, 'doubao:random');
  await read.click(); await page.waitForFunction(() => states.at(-1) === 'playing');
  await page.evaluate(() => audioItems[0].onended()); assert.equal(await page.evaluate(() => states.at(-1)), 'playing');
  await page.evaluate(() => audioItems.at(-1).onended());
  assert.equal(await page.evaluate(() => states.at(-1)), 'ready');
  const beforeReplay = requests.length;
  await read.click(); await page.waitForFunction(() => states.at(-1) === 'playing');
  assert.equal(requests.length, beforeReplay + 1);
  await stop.click(); fail = true;
  await read.click(); await page.waitForFunction(() => window.lastToast?.includes('豆包语音暂时'));
  assert.equal(await page.evaluate(() => calls.speak), 0); assert.equal(await stop.isVisible(), false);
  fail = false; await page.evaluate(() => window.blockAutoplay = true);
  await read.click(); await page.waitForFunction(() => states.at(-1) === 'paused');
  assert.equal(await stop.isVisible(), true);
  assert.doesNotMatch(await page.locator('body').innerText(), /正在朗读/);
  const before = requests.length; await read.click(); await page.waitForFunction(() => states.at(-1) === 'playing');
  assert.equal(requests.length, before); assert.equal(await page.evaluate(() => calls.speak), 0);
  await stop.click(); assert.equal(await page.evaluate(() => player.isActive()), false);
 } finally { await browser.close(); await new Promise(r => server.close(r)); }
});
