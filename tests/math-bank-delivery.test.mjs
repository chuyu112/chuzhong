import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

test('imported figures, choice grading and source evidence work in chat, reload and parent view', {timeout:45000},async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url)),dir=await mkdtemp(join(tmpdir(),'math-bank-ui-')),stub=join(dir,'fetch.mjs');
 await writeFile(stub,`globalThis.fetch=async(input,options)=>{
  if(new URL(input).hostname!=='open.bigmodel.cn')throw new Error('Unexpected network request');
  const body=JSON.parse(options.body);let message;
  if(JSON.stringify(body.messages[0]).includes('初中数学题目复核员'))message={role:'assistant',content:JSON.stringify({valid:true,answer:'C',reason:'圆柱侧面沿高展开是长方形。'})};
  else if(body.messages.at(-1).role==='tool')message={role:'assistant',content:'一起看看图形，再选出你认为正确的一项。'};
  else message={role:'assistant',content:null,tool_calls:[{id:'pick',type:'function',function:{name:'math_select_bank_question',arguments:JSON.stringify({topicId:'cnm_050',difficulty:'basic',questionType:'choice'})}}]};
  return new Response(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]}),{headers:{'content-type':'application/json'}});
 };`);
 const child=spawn(process.execPath,['--import',stub,'server/index.mjs'],{cwd:root,env:{...process.env,CUIYI_SOURCE_DIR:dir,EDU_DATA_DIR:dir,EDU_HOST:'127.0.0.1',EDU_PORT:'0',EDU_COOKIE_SECURE:'false',GLM_API_KEY:'test-only',GLM_API_URL:'https://open.bigmodel.cn/api/paas/v4',FLOVA_IMAGE_PROJECT_ID:'',LIBTV_VIDEO_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
 let browser;
 try{
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('startup timeout')),10000);child.stdout.on('data',d=>{const m=String(d).match(/http:\/\/127.0.0.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});});
  assert.equal((await fetch(base+'/api/math-bank/status')).status,401);
  assert.equal((await fetch(base+'/api/math-bank/figures/cnm_050_q1/A')).status,401);
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.Audio=class{play(){return Promise.resolve();}pause(){}};});
  await page.route('**/api/speech',route=>route.fulfill({contentType:'audio/mpeg',body:Buffer.from('test')}));
  await page.goto(base);await page.locator('#auth-register-tab').click();await page.locator('#auth-phone').fill('19900000096');await page.locator('#auth-password').fill('StudentPass123');await page.locator('#auth-confirm').fill('StudentPass123');await page.locator('#auth-submit').click();await page.locator('#chat-welcome').waitFor();
  const status=await (await page.request.get(base+'/api/math-bank/status')).json();assert.equal(status.total,1407);
  await page.locator('#chat-input').fill('从题库选一道认识立体图形的选择题');await page.locator('#send-chat').click();
  await page.waitForFunction(()=>document.querySelectorAll('.message .practice-figures img').length===5);
  await page.locator('.message .practice-figures').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>[...document.querySelectorAll('.message .practice-figures img')].every(img=>img.complete&&img.naturalWidth>0));
  await mkdir(join(root,'artifacts/math-bank-import'),{recursive:true});
  await page.screenshot({path:join(root,'artifacts/math-bank-import/mobile.png')});
  let learning=await (await page.request.get(base+'/api/learning')).json();
  const q=learning.questions.find(q=>q.type==='math-bank');assert.equal(q.bankId,'cnm_050_q1');assert.equal(q.questionType,'choice');
  for(const key of ['answer','bankReview','solution'])assert.equal(key in q,false);
  assert.match(await page.locator('.message.assistant').last().innerText(),/A. 见选项配图/);
  assert.doesNotMatch(await page.locator('.message.assistant').last().innerText(),/长方形/);
  const svg=await page.request.get(base+'/api/math-bank/figures/cnm_050_q1/A');assert.equal(svg.status(),200);assert.match(svg.headers()['content-security-policy'],/sandbox/);assert.match(svg.headers()['content-type'],/image\/svg\+xml/);
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.message .practice-figures img').length===5);
  await page.locator('#chat-input').fill('我选C');await page.locator('#send-chat').click();await page.getByText('对啦，这个结果正确！',{exact:false}).waitFor();
  learning=await (await page.request.get(base+'/api/learning')).json();assert.equal(learning.attempts.length,1);assert.equal(learning.attempts[0].correct,true);assert.equal(learning.attempts[0].bankId,'cnm_050_q1');
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-page="family"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#family-messages .practice-figures img').length===5);
  await page.locator('.family-evidence summary').click();await page.locator('#family-evidence').scrollIntoViewIfNeeded();assert.match(await page.locator('#family-evidence').innerText(),/cnm_050_q1/);
  await page.screenshot({path:join(root,'artifacts/math-bank-import/parent.png')});
  assert.deepEqual(errors,[]);
 }finally{
  await browser?.close();if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});
  await rm(dir,{recursive:true,force:true});
 }
});
