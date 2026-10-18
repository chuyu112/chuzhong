import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const root=fileURLToPath(new URL('..',import.meta.url));

test('queued follow-ups keep one conversation, celebrate verified steps, and never replay history', {timeout:60000}, async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'zhixu-flow-'));
 const child=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,EDU_DATA_DIR:directory,EDU_PORT:'0',EDU_HOST:'127.0.0.1',EDU_COOKIE_SECURE:'false'},stdio:['ignore','pipe','pipe']});
 let browser,db;
 try {
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('startup timeout')),15000);child.stdout.on('data',v=>{const m=String(v).match(/http:\/\/127.0.0.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});});
  db=new DatabaseSync(path.join(directory,'education.sqlite'));
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.chimes=0;window.speechStarts=0;window.Audio=class{play(){window.speechStarts++;return Promise.resolve();}pause(){}};const NativeAudio=window.AudioContext;window.AudioContext=class extends NativeAudio{createOscillator(){window.chimes++;return super.createOscillator();}};});
  await page.goto(base);await page.locator('#auth-register-tab').click();await page.locator('#auth-phone').fill('19900000051');await page.locator('#auth-password').fill('StudentPass123');await page.locator('#auth-confirm').fill('StudentPass123');await page.locator('#auth-submit').click();await page.locator('#chat-welcome').waitFor();
  const user=(await (await page.request.get(base+'/api/auth/me')).json()).user;
  let releaseFirst,releaseSecond;
  const firstGate=new Promise(r=>releaseFirst=r),secondGate=new Promise(r=>releaseSecond=r);
  const requests=[],messages=[];
  const speechRequests=[];
  await page.route('**/api/speech',async route=>{speechRequests.push(route.request().postDataJSON());await route.fulfill({status:200,headers:{'content-type':'audio/mpeg'},body:Buffer.from('test audio')});});
  await page.route('**/api/chat',async route=>{
   const payload=route.request().postDataJSON();requests.push(payload);const turn=requests.length;
   if(turn===1)await firstGate;if(turn===2)await secondGate;
   const text=turn===1?'对啦！你记得两边都减5，保持了等式的平衡。':turn===2?'答对啦！代回去，等式确实成立。':'我们再看一眼，这里还有一个符号需要调整。';
   const feedback=turn<3?{id:'verified-'+turn,kind:turn===1?'correct_step':'correct_answer'}:null;
   const at=new Date().toISOString();messages.push({role:'user',content:payload.text,at},{role:'assistant',content:text,agentName:'小直',at,feedback});
   db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?)').run(`u:${user.id}:session:${payload.sessionId}`,JSON.stringify({id:payload.sessionId,messages,hints:turn,status:'completed'}));
   await route.fulfill({contentType:'application/json',body:JSON.stringify({sessionId:payload.sessionId,text,feedback,hints:turn,agentName:'小直'})});
  });
  await page.locator('#chat-input').fill('3x+5=20，我先两边都减5，得到3x=15。');await page.locator('#send-chat').click();
  await page.locator('.message-pending').waitFor();assert.equal(await page.locator('#send-chat').isEnabled(),true);
  await page.locator('#chat-input').fill('那我再两边除以3，x=5，对吗？');await page.locator('#send-chat').click();
  assert.equal(await page.locator('.message.user').count(),2);assert.equal(await page.locator('#chat-input').inputValue(),'');assert.equal(await page.locator('.message-queued').count(),1);assert.equal(requests.length,1);
  await page.locator('#chat-input').fill('还没发出去的草稿');
  releaseFirst();await page.locator('.celebration-badge').waitFor();await page.getByRole('button',{name:'暂停朗读'}).waitFor();assert.equal(speechRequests.length,1);assert.match(await page.locator('.celebration-badge').innerText(),/这一步/);
  assert.ok(await page.evaluate(()=>chimes>=4));await mkdir(path.join(root,'artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/celebration-mobile.png')});
  await page.emulateMedia({reducedMotion:'reduce'});releaseSecond();await page.waitForFunction(()=>document.querySelector('.celebration-badge')?.textContent.includes('答对啦'));
  assert.equal(await page.locator('.celebration-confetti').count(),0);await page.locator('#chat-queue-status').waitFor({state:'hidden'});
  assert.equal(requests.length,2);assert.equal(speechRequests.length,2);assert.equal(requests[0].sessionId,requests[1].sessionId);assert.equal(await page.locator('#chat-input').inputValue(),'还没发出去的草稿');
  assert.deepEqual(await page.locator('.message').evaluateAll(els=>els.filter(e=>e.querySelector('small')?.textContent==='我'||!e.id).map(e=>e.classList.contains('user')?'user':'assistant').slice(-4)),['user','assistant','user','assistant']);
  await page.reload();await page.locator('.message.user').first().waitFor();assert.equal(await page.locator('.celebration').count(),0);assert.equal(await page.evaluate(()=>chimes),0);assert.equal(speechRequests.length,2);
  await page.locator('#chat-input').fill('那下一题，我算得x=6。');await page.locator('#send-chat').click();await page.getByText('我们再看一眼，这里还有一个符号需要调整。',{exact:true}).waitFor();await page.getByRole('button',{name:'暂停朗读'}).waitFor();assert.equal(await page.locator('.celebration').count(),0);assert.equal(await page.evaluate(()=>chimes),0);assert.equal(requests.length,3);assert.equal(speechRequests.length,3);
  await page.locator('#account-open').click();await page.locator('#customize-open').click();await page.locator('#custom-celebration').uncheck();await page.locator('#custom-celebration-sound').uncheck();await page.locator('#custom-save').click();await page.locator('#customize-dialog').waitFor({state:'hidden'});
  const settings=await (await page.request.get(base+'/api/appearance')).json();assert.equal(settings.celebration,false);assert.equal(settings.celebrationSound,false);assert.deepEqual(errors,[]);
 } finally { await browser?.close();db?.close();if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill('SIGTERM');});await rm(directory,{recursive:true,force:true}); }
});
