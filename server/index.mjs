import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { loadModelEnvironment, availableModels } from './config.mjs';
import { runTutor, canReveal } from './tutor.mjs';
import { createImageGenerationService, extractGeneratedImagePrompt } from './image-generation.mjs';
import { samples, grade, variant } from '../dist/core.js';
import { buildStudentMemory, defaultProfile } from './memory.mjs';
import { defaultAppearance, validateAppearance } from './appearance.mjs';
import { hasNickname, welcomeMessage, nicknameFromMessage } from '../dist/onboarding.js';
import { createAccountAuth } from './accounts.mjs';
import { createFamilyRoutes, publicSession, sessionList, sendSessionImage } from './family.mjs';
import { parseLearningFeedback, practiceEncouragement } from './learning-feedback.mjs';
import { createSpeechService, loadSpeechKey } from './speech.mjs';
import { DEFAULT_VOICE, resolveVoice } from '../dist/voice-options.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const data=process.env.EDU_DATA_DIR || resolve(root,'data');mkdirSync(data,{recursive:true});
const db=new DatabaseSync(resolve(data,'education.sqlite'));db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
const readDocument=(id,fallback)=>{const r=db.prepare('SELECT body FROM documents WHERE id=?').get(id);return r?JSON.parse(r.body):fallback;};
const writeDocument=(id,value)=>db.prepare('INSERT INTO documents(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(id,JSON.stringify(value));
const auth=createAccountAuth(db,{secure:process.env.EDU_COOKIE_SECURE==='true'});
const administrator=await auth.ensureAdmin(process.env.EDU_ADMIN_PHONE,process.env.EDU_ADMIN_INITIAL_PASSWORD);
// The named administrator owns the earlier single-family records; new users start fresh.
if(administrator&&!readDocument('legacy-migrated-to',null)){
 const legacy=db.prepare("SELECT id,body FROM documents WHERE id IN ('learning','profile') OR id LIKE 'session:%' OR id LIKE 'support:%'").all();
 for(const row of legacy){
  const value=JSON.parse(row.body),id=`u:${administrator.id}:${row.id}`;
  if(value.imageRef&&/^[a-f0-9]{64}$/.test(value.imageRef.filename)){
   const source=resolve(data,'homework',value.imageRef.filename);
   if(existsSync(source)){mkdirSync(resolve(data,'homework',administrator.id),{recursive:true});copyFileSync(source,resolve(data,'homework',administrator.id,value.imageRef.filename));}
  }
  db.prepare('INSERT OR IGNORE INTO documents(id,body) VALUES(?,?)').run(id,row.body);
 }
 writeDocument('legacy-migrated-to',{userId:administrator.id,at:new Date().toISOString(),documents:legacy.length});
}
const publicQuestion=({answer,solution,hints,...q})=>({...q,hintCount:hints?.length||0});
const archive=resolve(process.env.EDU_ARCHIVE_DIR||resolve(root,'../真题库'));
const paperManifest=()=>{try{return JSON.parse(readFileSync(resolve(archive,'download-manifest.json'),'utf8'));}catch{return {papers:[],counts:{}};}};
const environment=loadModelEnvironment();const models=availableModels(environment);
const speech=createSpeechService({apiKey:loadSpeechKey()});
const imageGeneration=createImageGenerationService({projectId:process.env.FLOVA_IMAGE_PROJECT_ID||'',cliPath:process.env.FLOVA_CLI_PATH||'flova'});
const busy=new Set();const host=process.env.EDU_HOST||'127.0.0.1';const port=Number(process.env.EDU_PORT||3018);
const activeImageJobs=new Set();
function send(res,status,body,type='application/json; charset=utf-8'){res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(type.startsWith('application/json')?JSON.stringify(body):body);}
function startImageJob({jobId,userId,sessionId,messageIndex,prompt}){
 const jobKey=`u:${userId}:image-job:${jobId}`,sessionKey=`u:${userId}:session:${sessionId}`;activeImageJobs.add(jobId);
 void (async()=>{
  try{
   const generated=await imageGeneration.generate(prompt,userId),filename=createHash('sha256').update(generated.buffer).digest('hex');
   mkdirSync(resolve(data,'illustrations',userId),{recursive:true});writeFileSync(resolve(data,'illustrations',userId,filename),generated.buffer);
   const session=readDocument(sessionKey,null),message=session?.messages?.[messageIndex];
   if(!message||message.imageJob?.id!==jobId)throw new Error('Image job no longer belongs to this message');
   message.generatedImageRef={filename,mimeType:generated.mimeType};message.imageJob.status='completed';writeDocument(sessionKey,session);
   const job=readDocument(jobKey,{});writeDocument(jobKey,{...job,status:'completed',completedAt:new Date().toISOString()});
  }catch{
   const job=readDocument(jobKey,{});writeDocument(jobKey,{...job,status:'failed',completedAt:new Date().toISOString()});
   const session=readDocument(sessionKey,null),message=session?.messages?.[messageIndex];
   if(message?.imageJob?.id===jobId){message.imageJob.status='failed';message.imageError='这次配图暂时没生成出来，讲解文字已经保留。';writeDocument(sessionKey,session);}
  }finally{activeImageJobs.delete(jobId);}
 })();
}
async function body(req,max=8*1024*1024){let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>max)throw Object.assign(new Error('请求过大'),{status:413});chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw Object.assign(new Error('无效 JSON'),{status:400});}}
const MAX_CHAT_IMAGES=9,MAX_CHAT_IMAGE_BYTES=10*1024*1024,MAX_CHAT_IMAGES_TOTAL=30*1024*1024;
function imageInput(value){const match=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(value));if(!match)throw Object.assign(new Error('请上传 JPG、PNG 或 WebP 图片'),{status:400});const bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.length>MAX_CHAT_IMAGE_BYTES)throw Object.assign(new Error('单张图片不能超过 10 MB'),{status:400});return {mimeType:match[1],base64:match[2],bytes};}
function imageInputs(input){const values=input.images!==undefined?input.images:input.image?[input.image]:[];if(!Array.isArray(values))throw Object.assign(new Error('图片附件格式不正确'),{status:400});if(values.length>MAX_CHAT_IMAGES)throw Object.assign(new Error(`一条消息最多附 ${MAX_CHAT_IMAGES} 张图片；整套试卷可以分批发送`),{status:400});const images=values.map(imageInput);if(images.reduce((sum,item)=>sum+item.bytes.length,0)>MAX_CHAT_IMAGES_TOTAL)throw Object.assign(new Error('这批图片总大小不能超过 30 MB，请分批发送'),{status:400});return images;}

const familyRoutes=createFamilyRoutes({db,data,readDocument,body,send});

const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host)return send(res,403,{error:'不允许跨站请求'});
  if(['/api/auth/register','/api/auth/login'].includes(url.pathname)&&req.method==='POST'){
   const result=await auth[url.pathname.endsWith('register')?'register':'login'](await body(req,20000));
   res.setHeader('set-cookie',result.cookie);return send(res,url.pathname.endsWith('register')?201:200,{user:result.user});
  }
  const user=auth.user(req);
  if(url.pathname==='/api/auth/me'&&req.method==='GET')return send(res,200,{user});
  if(url.pathname==='/api/auth/logout'&&req.method==='POST'){res.setHeader('set-cookie',auth.logout(req));return send(res,200,{ok:true});}
  const protectedRoute=url.pathname.startsWith('/api/')||url.pathname.startsWith('/papers/');
  if(protectedRoute&&!user)return send(res,401,{error:'请先登录或注册',login:true});
  if(url.pathname==='/api/auth/password'&&req.method==='POST'){
   const result=await auth.changePassword(user,await body(req,20000));res.setHeader('set-cookie',result.cookie);return send(res,200,{user:result.user});
  }
  if(protectedRoute&&user.mustChangePassword)return send(res,403,{error:'请先修改临时密码，再进入学习空间',passwordChangeRequired:true});
  if(url.pathname==='/api/speech'&&req.method==='POST'){
   const input=await body(req,40000),controller=new AbortController();
   const disconnected=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnected);
   try{
    const result=await speech.synthesize(user.id,input,controller.signal);
    if(!res.destroyed){res.setHeader('x-speech-voice',result.voiceId);res.setHeader('access-control-expose-headers','x-speech-voice');return send(res,200,result.audio,'audio/mpeg');}
   }finally{res.off('close',disconnected);}
   return;
  }
  if(url.pathname==='/api/admin/users'&&req.method==='GET')return send(res,200,{users:auth.listUsers(user)});
  if(url.pathname==='/api/admin/reset-password'&&req.method==='POST')return send(res,200,await auth.resetPassword(user,(await body(req,10000)).userId));
  if(protectedRoute&&await familyRoutes(req,res,url,user))return;
  const prefix=user?`u:${user.id}:`:null;
  const get=(id,fallback)=>readDocument(prefix+id,fallback);
  const put=(id,value)=>writeDocument(prefix+id,value);
  if(user){
   if(!get('learning',null))put('learning',{questions:samples,attempts:[],helpEvents:[]});
   if(!get('profile',null))put('profile',defaultProfile);
  }
  const memory=()=>buildStudentMemory(get('learning',{questions:[],attempts:[]}),get('profile',defaultProfile));
  const appearance=()=>{const value={...defaultAppearance,...get('appearance',{})};return {...value,voiceName:resolveVoice(value.voiceName)};};
  if(url.pathname==='/api/appearance'&&req.method==='GET')return send(res,200,appearance());
  if(url.pathname==='/api/appearance'&&req.method==='POST'){const settings=validateAppearance({...appearance(),...await body(req,1500000)});put('appearance',settings);return send(res,200,settings);}
  if(url.pathname==='/api/config')return send(res,200,{backend:true,models,defaultModel:models.find(m=>m.id==='glm-5.3-flash'&&m.configured)?.id||models.find(m=>m.configured)?.id||'glm-5.3-flash',piVersion:'1.1.0',mediaGeneration:imageGeneration.configured,imageModel:imageGeneration.configured?imageGeneration.model:null,longTermMemory:true});
  if(url.pathname==='/api/learning'&&req.method==='GET'){const learning=get('learning',{});return send(res,200,{...learning,questions:learning.questions.map(publicQuestion)});}
  if(url.pathname==='/api/memory'&&req.method==='GET')return send(res,200,memory());
  if(url.pathname==='/api/sessions'&&req.method==='GET'){
   return send(res,200,{sessions:sessionList(db,user.id)});
  }
  const imageJobRoute=/^\/api\/image-jobs\/([\w-]{1,80})$/.exec(url.pathname);
  if(imageJobRoute&&req.method==='GET'){
   const job=get(`image-job:${imageJobRoute[1]}`,null);if(!job)return send(res,404,{error:'配图任务不存在'});
   if(job.status==='pending'&&!activeImageJobs.has(imageJobRoute[1])){
    job.status='failed';job.error='这次配图暂时没生成出来，讲解文字已经保留。';put(`image-job:${imageJobRoute[1]}`,job);
    const saved=get(`session:${job.sessionId}`,null),message=saved?.messages?.[job.messageIndex];
    if(message?.imageJob?.id===imageJobRoute[1]){message.imageJob.status='failed';message.imageError=job.error;put(`session:${job.sessionId}`,saved);}
   }
   return send(res,200,{status:job.status,imageUrl:job.status==='completed'?`/api/sessions/${job.sessionId}/images/${job.messageIndex}`:null,imageError:job.status==='failed'?(job.error||'这次配图暂时没生成出来，讲解文字已经保留。'):''});
  }
  const photoRoute=/^\/api\/sessions\/([\w-]{1,80})\/images\/(\d{1,6})$/.exec(url.pathname);
  if(photoRoute&&req.method==='GET')return sendSessionImage(send,res,data,user.id,get(`session:${photoRoute[1]}`,{messages:[]}),Number(photoRoute[2]),Number(url.searchParams.get('item')||0));
  if(url.pathname.startsWith('/api/sessions/')&&req.method==='GET'){
   const id=url.pathname.split('/').at(-1);if(!/^[\w-]{1,80}$/.test(id))return send(res,400,{error:'无效会话'});
   return send(res,200,publicSession(get(`session:${id}`,{id,hints:0,messages:[{role:'assistant',kind:'greeting',content:welcomeMessage(get('profile',defaultProfile),appearance().agentName),agentName:appearance().agentName,at:new Date().toISOString()}]}),`/api/sessions/${id}/images`));
  }
  if(url.pathname==='/api/profile'&&req.method==='POST'){
   const input=await body(req,20000);const profile=get('profile',defaultProfile);
   if(input.displayName!==undefined){profile.displayName=String(input.displayName).trim().slice(0,30)||'同学';profile.nicknameConfirmed=profile.displayName!=='同学';}
   if(input.preferences!==undefined)profile.preferences=String(input.preferences).slice(0,1000);
   if(input.notes!==undefined){if(!Array.isArray(input.notes)||input.notes.length>50)return send(res,400,{error:'最多保存 50 条补充记录'});profile.notes=input.notes.map(note=>({text:String(typeof note==='string'?note:note.text||'').slice(0,500),source:'家庭手动记录',at:new Date().toISOString()})).filter(n=>n.text);}
   put('profile',profile);return send(res,200,profile);
  }
  if(url.pathname==='/api/papers'&&req.method==='GET'){const manifest=paperManifest();return send(res,200,{counts:manifest.counts,source:manifest.source,papers:manifest.papers.map(({id,title,year,subject,expectedPages,actualPages,status,sourceUrl,pageValidation})=>({id,title,year,subject,pages:actualPages||expectedPages,status,sourceUrl,pageValidation,href:status==='downloaded'?`/papers/archive/${id}`:null}))});}
  if(url.pathname==='/api/questions'&&req.method==='POST'){
   const input=await body(req,30000);const learning=get('learning',{});
   if(typeof input.stem!=='string'||!input.stem.trim()||input.stem.length>6000||!Number.isFinite(Number(input.answer))||String(input.answer).trim()==='')return send(res,400,{error:'请填写题干和数值答案；复杂题暂以原卷保存。'});
   const q={id:randomUUID(),stem:input.stem.trim(),answer:Number(input.answer),subject:String(input.subject||'数学').slice(0,30),topic:String(input.topic||'待标注').slice(0,50),source:String(input.source||'家长录入').slice(0,300),type:'imported',solution:String(input.solution||'').slice(0,6000),hints:['先圈出已知条件，再用自己的话说说要求什么。'],reviewStatus:'家长录入，未独立校对'};learning.questions.push(q);put('learning',learning);return send(res,201,publicQuestion(q));
  }
  if(url.pathname==='/api/hints'&&req.method==='POST'){
   const input=await body(req,10000);const q=get('learning',{}).questions.find(q=>q.id===input.questionId);if(!q)return send(res,404,{error:'题目不存在'});
   const support=get(`support:${q.id}`,{hintsUsed:0});const hint=q.hints[Math.min(support.hintsUsed,q.hints.length-1)];support.hintsUsed++;put(`support:${q.id}`,support);return send(res,200,{hint,hintsUsed:support.hintsUsed});
  }
  if(url.pathname==='/api/attempts'&&req.method==='POST'){
   const input=await body(req,10000);const learning=get('learning',{});const q=learning.questions.find(q=>q.id===input.questionId);if(!q)return send(res,404,{error:'题目不存在'});
   if(!String(input.answer??'').trim())return send(res,400,{error:'请先填写你的答案'});
   const support=get(`support:${q.id}`,{hintsUsed:0});
   const attempt={id:randomUUID(),questionId:q.id,answer:String(input.answer).slice(0,500),correct:grade(q,input.answer),hintsUsed:support.hintsUsed,support:support.solutionSeen?'solution':support.hintsUsed>0?'hint':'none',at:new Date().toISOString()};
   const encouragement=practiceEncouragement(attempt,learning.attempts),firstCorrect=attempt.correct&&!learning.attempts.some(a=>a.questionId===q.id&&a.correct);
   learning.attempts.push(attempt);put('learning',learning);put(`support:${q.id}`,{...support,solutionSeen:true});return send(res,201,{...attempt,solution:q.solution,encouragement,feedback:firstCorrect?{id:attempt.id,kind:'correct_answer'}:null});
  }
  if(url.pathname==='/api/variants'&&req.method==='POST'){const input=await body(req,10000);const learning=get('learning',{});const q=learning.questions.find(q=>q.id===input.questionId);if(!q?.template)return send(res,400,{error:'该题尚无变式模板'});const generated=variant(q);learning.questions.push(generated);put('learning',learning);return send(res,201,publicQuestion(generated));}
  if(url.pathname==='/api/chat'&&req.method==='POST'){
   const input=await body(req,45*1024*1024);const text=String(input.text||'').trim();if(!text||text.length>12000)return send(res,400,{error:'请输入 1—12000 字的问题'});
   const id=/^[\w-]{1,80}$/.test(input.sessionId||'')?input.sessionId:randomUUID();if(busy.has(user.id))return send(res,409,{error:'老师正在回答，请等这一轮完成'});
   const profile=get('profile',defaultProfile),agentName=appearance().agentName;
   const session=get(`session:${id}`,{id,hints:0,messages:[{role:'assistant',kind:'greeting',content:welcomeMessage(profile,agentName),agentName,at:new Date().toISOString()}],attempt:''});
   const requestedImages=imageInputs(input);
   const nickname=!requestedImages.length&&!input.reveal&&!input.media?nicknameFromMessage(text,!hasNickname(profile)&&!profile.nicknameAsked&&session.messages.at(-1)?.kind==='greeting'):null;
   if(nickname){
    profile.displayName=nickname;profile.nicknameConfirmed=true;profile.nicknameAsked=true;put('profile',profile);
    const at=new Date().toISOString(),reply=`好呀，${nickname}！我记住啦，以后就这样称呼你。你今天想聊点什么？有不会的题，也可以直接发给我。`;
    session.messages.push({role:'user',content:text,at},{role:'assistant',content:reply,kind:'nickname',agentName,at});session.status='completed';put(`session:${id}`,session);
    return send(res,200,{sessionId:id,text:reply,agentName,hints:session.hints});
   }
   const model=models.find(m=>m.id===input.modelId&&m.configured);if(!model)return send(res,503,{error:'这个模型尚未读取到配置，请选择已配置模型。'});
   const reveal=input.reveal===true;if(reveal&&(requestedImages.length||!canReveal(session,String(input.attempt||session.attempt))))return send(res,409,{error:'先听一个提示，再写下你的尝试，然后一起核对步骤。'});
   if(requestedImages.length&&!model.vision)return send(res,400,{error:'请先选择支持识图的模型。'});
   let images=requestedImages;
   const previousRefs=session.imageRefs|| (session.imageRef?[session.imageRef]:[]);
   if(requestedImages.length){
    if(session.imageRef&&!session.messages.some(m=>m.imageRef||m.imageRefs)){const previous=session.messages.find(m=>m.role==='user');if(previous)previous.imageRef=session.imageRef;}
    const refs=[];for(const item of requestedImages){const filename=createHash('sha256').update(item.bytes).digest('hex');mkdirSync(resolve(data,'homework',user.id),{recursive:true});writeFileSync(resolve(data,'homework',user.id,filename),item.bytes);refs.push({filename,mimeType:item.mimeType});}
    session.imageRefs=refs;session.imageRef=refs[0];session.hints=0;session.attempt='';session.questionId=null;
   }else if(previousRefs.length){
    images=previousRefs.map(ref=>{if(!/^[a-f0-9]{64}$/.test(ref.filename)||!/^image\/(jpeg|png|webp)$/.test(ref.mimeType))throw Object.assign(new Error('历史图片暂时无法读取，请重新上传'),{status:400});const bytes=readFileSync(resolve(data,'homework',user.id,ref.filename));if(bytes.length>MAX_CHAT_IMAGE_BYTES)throw Object.assign(new Error('历史图片超过当前读取限制，请重新上传'),{status:400});return {mimeType:ref.mimeType,base64:bytes.toString('base64'),bytes};});
   }
   if(images.length&&!model.vision)return send(res,400,{error:'这轮对话包含作业照片，请选择支持识图的模型。'});
   if(input.questionId)session.questionId=String(input.questionId).slice(0,100);
   const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),280000);res.on('close',()=>{if(!res.writableEnded)controller.abort();});busy.add(user.id);
   if(!hasNickname(profile)){profile.nicknameAsked=true;put('profile',profile);}
   const historySession={...session,messages:[...session.messages]};
   session.messages.push({role:'user',content:text,at:new Date().toISOString(),...(requestedImages.length?{imageRefs:session.imageRefs,imageRef:session.imageRef}:{})});session.status='pending';put(`session:${id}`,session);
   try{
    const media=['图片','视频','Blender 3D'].includes(input.media)?input.media:'';
    const raw=await runTutor({session:historySession,text,modelId:model.id,images,environment,memory:memory(),agentName,reveal,media,generateVisual:imageGeneration.configured&&!media,signal:controller.signal});
    const withImage=extractGeneratedImagePrompt(raw);
    const parsed=parseLearningFeedback(withImage.text,text,historySession.messages);if(!parsed.text)throw new Error('模型未返回讲解');
    const result=parsed.text,feedback=parsed.feedback?{...parsed.feedback,id:randomUUID()}:null;
    const at=new Date().toISOString(),imageJobId=withImage.prompt&&imageGeneration.configured&&!media?randomUUID():null,messageIndex=session.messages.length;
    const assistantMessage={role:'assistant',content:result,agentName,at,...(imageJobId?{imageJob:{id:imageJobId,status:'pending'}}:{}),...(feedback?{feedback}:{})};
    session.messages.push(assistantMessage);session.status='completed';session.hints++;if(input.attempt)session.attempt=String(input.attempt).slice(0,6000);put(`session:${id}`,session);
    if(imageJobId){put(`image-job:${imageJobId}`,{sessionId:id,messageIndex,status:'pending',createdAt:at});startImageJob({jobId:imageJobId,userId:user.id,sessionId:id,messageIndex,prompt:withImage.prompt});}
    const learning=get('learning',{});learning.helpEvents||=[];const q=learning.questions.find(q=>q.id===session.questionId);learning.helpEvents.push({id:randomUUID(),sessionId:id,at,subject:q?.subject||'待识别',topic:q?.topic||'未标注',questionId:q?.id||null,action:reveal?'reviewed_solution':'asked_for_help'});put('learning',learning);
    if(q){const support=get(`support:${q.id}`,{hintsUsed:0});put(`support:${q.id}`,{...support,hintsUsed:support.hintsUsed+1,solutionSeen:support.solutionSeen||reveal});}
    return send(res,200,{sessionId:id,text:result,agentName,hints:session.hints,feedback,imageUrl:null,imageJobId});
   }catch{const error='这次讲解未完成，请稍后重试。';session.messages.push({role:'assistant',content:error,status:'error',agentName,at:new Date().toISOString()});session.status='failed';put(`session:${id}`,session);return send(res,502,{error});}finally{clearTimeout(timeout);busy.delete(user.id);}
  }
  if(url.pathname==='/api/export')return send(res,200,{version:2,exportedAt:new Date().toISOString(),learning:get('learning',{}),memory:memory(),sessions:db.prepare('SELECT body FROM documents WHERE id LIKE ?').all(prefix+'session:%').map(row=>JSON.parse(row.body))});
  if(url.pathname.startsWith('/papers/archive/')){const id=url.pathname.split('/').at(-1);const paper=paperManifest().papers.find(p=>p.id===id&&p.status==='downloaded');if(!paper?.relativePath)return send(res,404,{error:'尚未下载该试卷'});const path=resolve(archive,paper.relativePath);if(!path.startsWith(archive+'/')||!existsSync(path))return send(res,404,{error:'文件不存在'});return send(res,200,readFileSync(path),'application/pdf');}
  if(url.pathname.startsWith('/papers/')){const name=url.pathname.slice(8);if(name!=='shenzhen-2023-2024-recalled.pdf')return send(res,404,{error:'文件不存在'});const p=resolve(data,'papers',name);if(!existsSync(p))return send(res,404,{error:'本机尚未下载该文件'});return send(res,200,readFileSync(p),'application/pdf');}
  if(url.pathname.startsWith('/api/'))return send(res,404,{error:'接口不存在'});
  const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));const path=resolve(root,'dist',relative);if(!path.startsWith(resolve(root,'dist')+'/')||!existsSync(path))return send(res,404,'Not found','text/plain');
  const type={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.woff2':'font/woff2','.woff':'font/woff','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'}[extname(path)]||'application/octet-stream';
  return send(res,200,readFileSync(path),type);
 }catch(error){if(!res.headersSent)send(res,error.status||500,{error:error.status?error.message:'请求处理失败，请重试'});}
});
server.listen(port,host,()=>console.log(`知序教育已启动：http://${host}:${server.address().port} · 已配置模型 ${models.filter(m=>m.configured).length}/${models.length} · Pi 1.1.0`));
for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>server.close(()=>{db.close();process.exit(0);}));
