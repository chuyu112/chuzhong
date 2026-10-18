import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {createServer} from 'node:http';import {readFileSync} from 'node:fs';
test('read button toggles pause/resume, global stop cancels, and late audio never plays after cancellation',{timeout:30000},async()=>{
 const server=createServer((req,res)=>{if(req.url==='/'){res.setHeader('content-type','text/html');return res.end('<div id="speech-bar" hidden><span id="speech-status"></span><button id="speech-stop">停止朗读</button></div><button id="read">朗读</button>');}if(!['/speech-player.js','/core.js'].includes(req.url)){res.writeHead(404);return res.end();}res.setHeader('content-type','text/javascript');res.end(readFileSync(new URL('../dist'+req.url,import.meta.url)));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage();await page.addInitScript(()=>{window.calls={speak:0,pause:0,resume:0,cancel:0,play:0,audioPause:0};window.utterances=[];Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],cancel:()=>calls.cancel++,pause:()=>calls.pause++,resume:()=>calls.resume++,speak:u=>{calls.speak++;utterances.push(u);u.onstart?.();}}});window.Audio=class{play(){calls.play++;return Promise.resolve();}pause(){calls.audioPause++;}};});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(async()=>{const {createSpeechPlayer}=await import('/speech-player.js');window.player=createSpeechPlayer({toast:text=>{window.lastToast=text;}});window.voice={name:'',rate:1};window.states=[];document.querySelector('#read').onclick=()=>player.toggle({text:'你好，先一起想明白。',voice,button:document.querySelector('#read'),onState:s=>{states.push(s);}});});
  await page.locator('#read').click();assert.equal(await page.evaluate(()=>states.at(-1)),'playing');
  await page.locator('#read').click();assert.equal(await page.evaluate(()=>states.at(-1)),'paused');assert.equal(await page.evaluate(()=>calls.pause),1);
  await page.locator('#read').click();assert.equal(await page.evaluate(()=>calls.resume),1);assert.equal(await page.evaluate(()=>calls.speak),1);
  await page.locator('#speech-stop').click();assert.equal(await page.locator('#speech-bar').isVisible(),false);assert.equal(await page.evaluate(()=>states.at(-1)),'idle');
  let release;const gate=new Promise(resolve=>release=resolve);await page.route('**/api/speech',async route=>{await gate;await route.fulfill({contentType:'audio/mpeg',body:Buffer.from('test audio')}).catch(()=>{});});
  await page.evaluate(()=>voice.name='doubao:test');await page.locator('#read').click();assert.equal(await page.evaluate(()=>states.at(-1)),'loading');await page.locator('#speech-stop').click();release();await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>calls.play),0);
  await page.locator('#read').click();await page.waitForFunction(()=>states.at(-1)==='playing');await page.locator('#read').click();assert.equal(await page.evaluate(()=>states.at(-1)),'paused');await page.locator('#read').click();assert.equal(await page.evaluate(()=>calls.play),2);
  await page.evaluate(()=>utterances[0].onend());assert.equal(await page.evaluate(()=>states.at(-1)),'playing');
  await page.locator('#speech-stop').click();assert.equal(await page.locator('#speech-bar').isVisible(),false);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
