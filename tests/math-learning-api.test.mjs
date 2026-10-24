import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

test('chat persists verified practice, observations and scores per account; failed model turns do not publish exercises', {timeout:30000}, async()=>{
 const root=fileURLToPath(new URL('..',import.meta.url)),dir=await mkdtemp(join(tmpdir(),'math-chat-api-'));
 const stub=join(dir,'fetch.mjs');
 await writeFile(stub,`globalThis.fetch=async(input,options)=>{
  if(new URL(input).hostname!=='open.bigmodel.cn')throw new Error('Unexpected network request');
  const body=JSON.parse(options.body),lastUser=body.messages.filter(m=>m.role==='user').at(-1);
  const text=typeof lastUser.content==='string'?lastUser.content:JSON.stringify(lastUser.content);
  const afterTool=body.messages.at(-1).role==='tool';
  const make=(name,args,id)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
  let message;
  if(text.includes('出一道方程')){
   message=afterTool?{role:'assistant',content:'好，先自己试一步。'}:{role:'assistant',content:null,tool_calls:[
    make('math_observe',{topicId:'cnm_042',evidence:'出一道方程',source:'student_text',hypothesis:'需要先观察作答，不能判断强弱。',prerequisiteId:''},'observe'),
    make('math_create_practice',{topicId:'cnm_042'},'practice')
   ]};
  }else if(text.includes('失败测试')){
   if(afterTool)throw new Error('Simulated provider failure');
   message={role:'assistant',content:null,tool_calls:[make('math_create_practice',{topicId:'cnm_042'},'failed-practice')]};
  }else message={role:'assistant',content:'对啦，结果核对正确。'};
  return new Response(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]}),{headers:{'content-type':'application/json'}});
 };`);
 const child=spawn(process.execPath,['--import',stub,'server/index.mjs'],{cwd:root,env:{...process.env,CUIYI_SOURCE_DIR:dir,EDU_DATA_DIR:dir,EDU_HOST:'127.0.0.1',EDU_PORT:'0',EDU_COOKIE_SECURE:'false',GLM_API_KEY:'test-only',GLM_API_URL:'https://open.bigmodel.cn/api/paas/v4',FLOVA_IMAGE_PROJECT_ID:'',LIBTV_VIDEO_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
 let db;
 try{
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('startup timeout')),10000);child.stdout.on('data',d=>{const m=String(d).match(/http:\/\/127.0.0.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});});
  const register=async phone=>{const r=await fetch(base+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone,password:'TestPassword123'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie').split(';')[0],user:(await r.json()).user};};
  const account=await register('19900000087'),other=await register('19900000088');
  const get=async(path,who=account)=>{const r=await fetch(base+path,{headers:{cookie:who.cookie}});assert.equal(r.status,200);return r.json();};
  const chat=async(text,expected=200)=>{const r=await fetch(base+'/api/chat',{method:'POST',headers:{cookie:account.cookie,'content-type':'application/json'},body:JSON.stringify({sessionId:'equation',text,modelId:'glm-5.3-flash'})});assert.equal(r.status,expected);return r.json();};
  const first=await chat('出一道方程');
  assert.match(first.text,/自编练习（非真题）/);
  let learning=await get('/api/learning');
  assert.equal(learning.observations.length,1);
  let questions=learning.questions.filter(q=>q.type==='math-practice');assert.equal(questions.length,1);
  assert.equal('validation' in questions[0],false);assert.equal('answer' in questions[0],false);
  db=new DatabaseSync(join(dir,'education.sqlite'));
  const raw=JSON.parse(db.prepare('SELECT body FROM documents WHERE id=?').get('u:'+account.user.id+':learning').body);
  const q=raw.questions.find(q=>q.id===questions[0].id);
  await chat('x='+q.answer);
  learning=await get('/api/learning');assert.equal(learning.attempts.length,1);assert.equal(learning.attempts[0].correct,true);
  const memory=await get('/api/memory');assert.equal(memory.topics.find(t=>t.topicId==='cnm_042').independentQuestions,1);assert.equal(memory.strengths.length,0);
  const family=await get('/api/family/students/'+account.user.id);
  assert.equal(family.memory.topics.find(t=>t.topicId==='cnm_042').observationCount,1);
  assert.equal((await get('/api/learning',other)).questions.some(q=>q.type==='math-practice'),false);
  assert.equal((await get('/api/sessions/equation',other)).messages.some(m=>m.content.includes(q.stem)),false);
  await chat('失败测试',502);
  learning=await get('/api/learning');assert.equal(learning.questions.filter(q=>q.type==='math-practice').length,1);
  assert.equal(learning.attempts.length,1);
  assert.equal((await get('/api/sessions/equation')).messages.at(-1).status,'error');
 }finally{
  db?.close();if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});
  await rm(dir,{recursive:true,force:true});
 }
});
