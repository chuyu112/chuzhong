import { createCelebration } from './celebration.js';
import { createSpeechPlayer } from './speech-player.js';
import { createVideoUI } from './video-ui.js';
import { setupAppearance } from './appearance-ui.js';
import { welcomeMessage, DEFAULT_AGENT_NAME } from './onboarding.js';
import { setupFamily } from './family-ui.js';
import { startAccount } from './account-ui.js';
import renderMathInElement from './vendor/katex/contrib/auto-render.mjs';
const $ = id => document.getElementById(id);
const state = { config:null,learning:{questions:[],attempts:[]},memory:null,papers:[],question:null,sessionId:crypto.randomUUID(),user:null,chatQuestionId:null,images:[],sending:false,chatQueue:[] };
let toastTimer;
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
async function api(url,data,options={}){const response=await fetch(url,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),...options});const result=await response.json();if(!response.ok){if(response.status===401||result.passwordChangeRequired)location.reload();throw new Error(result.error||'请求失败');}return result;}
const action = fn => async event => {try{await fn(event);}catch(error){toast(error.message);}};
const videoUI=createVideoUI({api,getState:()=>state,getModelId:()=>$('model-select').value,stopSpeech:()=>speech.stop(),toast});
function node(tag,className,text){const item=document.createElement(tag);if(className)item.className=className;if(text!==undefined)item.textContent=text;return item;}
function page(name){speech.stop();celebration.stop();closeNavigation();$('current-page-label').textContent={tutor:`问问${appearance.agentName()}`,library:'我的真题库',growth:'成长记录',family:'家长后台'}[name]||`问问${appearance.agentName()}`;document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===name));document.querySelectorAll('.bottom-nav button').forEach(el=>el.classList.toggle('active',el.dataset.page===name));window.scrollTo({top:0,behavior:'smooth'});if(name==='family')family.refresh().catch(e=>toast(e.message));if(name==='growth')refreshMemory().catch(e=>toast(e.message));if(name==='library')refreshPapers().catch(e=>toast(e.message));}
document.querySelectorAll('[data-page]').forEach(el=>el.addEventListener('click',()=>page(el.dataset.page)));
function statCard(value,label){const el=node('div','stat');el.append(node('strong','',String(value)),node('span','',label));return el;}
function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','icon');svg.setAttribute('aria-hidden','true');const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href',`#i-${name}`);svg.append(use);return svg;}
async function refreshLearning(){state.learning=await api('/api/learning');}
function openPractice(q){state.question=q;$('practice-topic').textContent=q.topic;$('practice-source').textContent=q.source;$('practice-stem').textContent=q.stem;$('practice-hints').replaceChildren();$('practice-result').textContent='';$('practice-answer').value='';$('make-variant').hidden=true;if(!$('practice-dialog').open)$('practice-dialog').showModal();}
$('close-practice').onclick=()=>$('practice-dialog').close();
$('practice-hint').onclick=action(async()=>{const result=await api('/api/hints',{questionId:state.question.id});$('practice-hints').append(node('p','',result.hint));});
$('practice-form').onsubmit=action(async event=>{event.preventDefault();celebration.prepare();const result=await api('/api/attempts',{questionId:state.question.id,answer:$('practice-answer').value});$('practice-result').textContent=(result.encouragement||(result.correct?'答对啦！':'我们再一起看看这一步。'))+'\n\n'+(result.solution||'这道题暂未录入参考讲解，可以请老师一起核对。');$('make-variant').hidden=!state.question.template;state.learning.attempts.push(result);celebration.show(result.feedback);await refreshMemory();});
$('make-variant').onclick=action(async()=>{const q=await api('/api/variants',{questionId:state.question.id});state.learning.questions.push(q);openPractice(q);});
function freshChat(){speech.stop();celebration.stop();$('chat-input').value='';state.sessionId=crypto.randomUUID();localStorage.setItem('zhixu-session-'+state.user.id,state.sessionId);state.chatQuestionId=null;state.images=[];$('student-attempt').value='';$('photo-preview').replaceChildren();$('photo-preview').hidden=true;$('messages').replaceChildren();showChatWelcome();}
$('new-chat').onclick=$('new-chat-header').onclick=()=>{if(state.sending)return toast('请等这一轮讲解完成。');freshChat();page('tutor');refreshConversations().catch(e=>toast(e.message));$('chat-input').focus();};
$('ask-about-practice').onclick=()=>{if(state.sending)return toast('请等这一轮讲解完成。');const q=state.question;$('practice-dialog').close();freshChat();state.chatQuestionId=q.id;$('chat-input').value=`请先帮我理解这道题，给我一个提示：\n${q.stem}`;page('tutor');};
function addMessage(role,text,imageUrls,agentName=appearance.agentName(),imageError='',imageJob=null){
 $('chat-welcome')?.removeAttribute('id');const el=node('div',`message ${role}`),content=node('div','message-content');
 for(const part of text.split(/(\*\*[^*]+\*\*)/g))content.append(part.startsWith('**')&&part.endsWith('**')?node('strong','',part.slice(2,-2)):document.createTextNode(part));
 renderMathInElement(content,{delimiters:[{left:'$$',right:'$$',display:true},{left:'\\[',right:'\\]',display:true},{left:'\\(',right:'\\)',display:false},{left:'$',right:'$',display:false}],trust:false,throwOnError:false,maxExpand:1000,maxSize:20});el.append(node('small','',role==='user'?'我':agentName));
 el.append(content);
 const urls=(Array.isArray(imageUrls)?imageUrls:imageUrls?[imageUrls]:[]);if(urls.length&&role!=='assistant')appendMessageImages(el,urls,role);
 if(imageJob?.status==='pending'){const status=node('small','image-generation-status','小直正在画这张图…');status.dataset.imageJobId=imageJob.id;el.append(status);}if(imageError)el.append(node('small','image-generation-error',imageError));
 if(role==='assistant'){const controls=node('div','speech-controls'),button=node('button','read-aloud',''),stopButton=node('button','stop-aloud','');button.type=stopButton.type='button';button.dataset.speechReady='false';button.innerHTML='<svg class="icon" aria-hidden="true"><use href="#i-volume"></use></svg>';button.setAttribute('aria-label','朗读这条回复');button.title='朗读';stopButton.innerHTML='<svg class="icon" aria-hidden="true"><use href="#i-stop"></use></svg>';stopButton.setAttribute('aria-label','停止朗读');stopButton.title='停止朗读';stopButton.hidden=true;button.onclick=()=>speak(text,button,{stopButton});stopButton.onclick=()=>speech.stop();controls.append(button,stopButton);el.append(controls);}
 if(urls.length&&role==='assistant')appendMessageImages(el,urls,role);
 $('messages').append(el);$('messages').scrollTop=$('messages').scrollHeight;return el;
}
function appendMessageImages(message,urls,role='assistant'){
 const scroller=$('messages'),scrollTop=scroller.scrollTop;
 const followImage=!message.isConnected||scroller.scrollHeight-scroller.clientHeight-scrollTop<80;
 const generated=role==='assistant',gallery=node('div',`chat-attachments${generated?' generated-illustration':''}`);
 urls.forEach((url,index)=>{const img=node('img','chat-attachment');img.alt=role==='user'?`作业附件第 ${index+1} 张`:'小直生成的学习图解';
  if(generated)img.addEventListener('load',()=>{if(followImage&&message.isConnected&&message===scroller.lastElementChild&&scroller.scrollTop>=scrollTop-8)gallery.scrollIntoView({block:'nearest',behavior:'smooth'});},{once:true});
  img.src=url;gallery.append(img);
 });
 const content=message.querySelector('.message-content');if(generated)message.insertBefore(gallery,message.querySelector('.learning-video'));else message.insertBefore(gallery,content||null);
}
function showImageJobError(message,error){message.querySelector('.image-generation-status')?.remove();if(error&&!message.querySelector('.image-generation-error'))message.append(node('small','image-generation-error',error));}
async function watchImageJob(jobId,sessionId,message){
 if(!jobId)return;
 while(message.isConnected&&state.sessionId===sessionId){
  const status=message.querySelector('.image-generation-status');if(!status||status.dataset.imageJobId!==jobId)return;
  try{
   const result=await api(`/api/image-jobs/${encodeURIComponent(jobId)}`,undefined,{signal:AbortSignal.timeout(10000)});
   if(result.status==='completed'&&result.imageUrl){message.querySelector('.image-generation-status')?.remove();appendMessageImages(message,[result.imageUrl]);return;}
   if(result.status==='skipped'){message.querySelector('.image-generation-status')?.remove();return;}
   if(result.status==='failed'){showImageJobError(message,result.imageError||'这次配图暂时没生成出来，讲解文字已经保留。');return;}
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,2000));
 }
}
function speak(text,button,{preserveCelebration=false,stopButton=null}={}){if(!preserveCelebration)celebration.stop();return speech.toggle({text,voice:appearance.voiceOptions(),button,stopButton,onState:status=>{
 const icon=status==='playing'?'i-pause':status==='paused'?'i-play':'i-volume';button.innerHTML=`<svg class="icon" aria-hidden="true"><use href="#${icon}"></use></svg>`;
 button.dataset.speechReady=String(status==='playing'||status==='paused'||status==='ready');button.setAttribute('aria-label',status==='playing'?'暂停朗读':status==='paused'?'继续朗读':status==='loading'?'取消朗读':status==='ready'?'重新朗读这条回复':'朗读这条回复');button.title=status==='playing'?'暂停朗读':status==='paused'?'继续朗读':status==='ready'?'重新朗读':'朗读';button.setAttribute('aria-pressed',String(status==='playing'));
}});}
function updateChatStatus(){
 const queued=state.chatQueue.length-(state.sending?1:0);
 $('chat-queue-status').hidden=!state.sending;
 $('chat-queue-status').textContent=queued>0?`还有 ${queued} 条追问，收到后会依次回答。`:`${appearance.agentName()}正在回复，你可以继续补充或追问。`;
 $('send-chat').disabled=false;
}
async function sendChat({text,reveal=false,media=''}={}){
 const prompt=(text||$('chat-input').value||(state.images.length?'请按顺序读清楚这组题目照片，先讲解思路，给我第一步提示。':'')).trim();
 if(!prompt)return;
 if(state.chatQueue.length>=6)return toast('追问已经收到了好几条，先等小直回答一下。');
 const modelId=$('model-select').value,attempt=$('student-attempt').value.trim();
 if(reveal&&attempt.length<2)return toast('请先写下你尝试的步骤。');
 if(state.images.length&&!state.config.models.find(m=>m.id===modelId)?.vision)return toast('请先选择支持识图的模型。');
 celebration.prepare();
 const payload={text:prompt,sessionId:state.sessionId,questionId:state.chatQuestionId,modelId,images:state.images.slice(),reveal,attempt,media};
 const agentName=appearance.agentName();
 addMessage('user',prompt,payload.images);
 if(!text)$('chat-input').value='';
 state.images=[];renderPhotoPreview();
 const pending=addMessage('assistant',state.sending?'收到这条追问了，稍后接着讲。':`${agentName}正在思考…`,null,agentName);
 pending.classList.add('message-pending');if(state.sending)pending.classList.add('message-queued');
 pending.setAttribute('role','status');pending.querySelector('.speech-controls')?.remove();
 state.chatQueue.push({payload,agentName,pending});updateChatStatus();
 return processChatQueue();
}
async function processChatQueue(){
 if(state.sending)return;
 state.sending=true;updateChatStatus();
 try{
  while(state.chatQueue.length){
   const {payload,agentName,pending}=state.chatQueue[0];
   pending.classList.remove('message-queued');pending.querySelector('div').textContent=`${agentName}正在思考…`;
   try{
    const result=await api('/api/chat',payload,{signal:AbortSignal.timeout(290000)});
    state.sessionId=result.sessionId;localStorage.setItem('zhixu-session-'+state.user.id,state.sessionId);
    const reply=addMessage('assistant',result.text,result.imageUrl||null,result.agentName||agentName,result.imageError||'',result.imageJobId?{id:result.imageJobId,status:'pending'}:null);pending.replaceWith(reply);
    if(result.imageJobId)void watchImageJob(result.imageJobId,result.sessionId,reply);
    videoUI.attach(reply,{role:'assistant',videoJob:result.videoJob,videoError:result.videoError,videoUrl:result.videoUrl},result.sessionId,result.messageIndex);
    if(result.resumedVideoJob)videoUI.resume(result.resumedVideoJob,result.sessionId);
    celebration.show(result.feedback);const readButton=reply.querySelector('.read-aloud');if(readButton)void speak(result.text,readButton,{preserveCelebration:true,stopButton:reply.querySelector('.stop-aloud')});
   }catch(error){
    const message=error.name==='TimeoutError'?'等待回复超时，请稍后重试。':error.message;
    const failed=addMessage('assistant',`本轮未完成：${message}`,null,agentName);pending.replaceWith(failed);
    failed.querySelector('.speech-controls')?.remove();
    const restore=node('button','','放回输入框');restore.type='button';
    restore.onclick=()=>{
     if($('chat-input').value.trim()||state.images.length)return toast('输入框里还有未发送的内容，请先处理这份草稿。');
     $('chat-input').value=payload.text;state.images=payload.images.slice();renderPhotoPreview();$('chat-input').focus();
    };
    failed.append(restore);toast(message);
   }finally{state.chatQueue.shift();updateChatStatus();}
  }
 }finally{
  state.sending=false;updateChatStatus();
  void Promise.all([refreshMemory(),refreshConversations()]).catch(error=>toast(error.message));
 }
}
$('chat-form').onsubmit=action(async event=>{event.preventDefault();await sendChat();});
$('reveal-answer').onclick=action(()=>{if($('student-attempt').value.trim().length<2)return toast('请先写下你尝试的步骤。');$('review-dialog').close();return sendChat({text:`我已经尝试，请核对我的步骤并讲解：\n${$('student-attempt').value}`,reveal:true});});
$('media-prompt').onclick=action(()=>{$('media-dialog').close();return sendChat({text:`请把已经讲过的这一步转换成${$('media-type').value}制作提示词，保持当前教学进度。`,media:$('media-type').value});});
function choosePhoto(){$('photo-input').click();}
$('photo-chat').onclick=choosePhoto;
function renderPhotoPreview(){
 $('photo-preview').replaceChildren();$('photo-preview').hidden=!state.images.length;if(!state.images.length)return;
 state.images.forEach((image,index)=>{const item=node('div','photo-preview-item'),img=node('img');img.src=image;img.alt=`准备发送的作业图片第 ${index+1} 张`;const label=node('small','',`${index+1}/${state.images.length}`);const remove=node('button','','移除');remove.type='button';remove.setAttribute('aria-label',`移除第 ${index+1} 张图片`);remove.onclick=()=>{state.images.splice(index,1);renderPhotoPreview();};item.append(img,label,remove);$('photo-preview').append(item);});
}
async function attachPhoto(file){
 if(!file||!file.type.startsWith('image/'))throw new Error('请上传图片，支持常见图片格式。');
 if(state.images.length>=9)throw new Error('一条消息最多附 9 张图片；整套试卷可以分批发送。');
 if(file.size>25*1024*1024)throw new Error('请使用 25 MB 以内的图片。');
 const bitmap=await createImageBitmap(file),ratio=Math.min(1,1800/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
 canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
 const image=canvas.toDataURL('image/jpeg',.88),bytes=Math.ceil((image.length-image.indexOf(',')-1)*.75);if(bytes>10*1024*1024)throw new Error('压缩后这张图片仍超过 10 MB，请换一张较清晰的小图。');const total=state.images.reduce((sum,value)=>sum+Math.ceil((value.length-value.indexOf(',')-1)*.75),0);if(total+bytes>30*1024*1024)throw new Error('这批图片总大小不能超过 30 MB，请分批发送。');state.images.push(image);renderPhotoPreview();
 const model=state.config.models.find(m=>m.id===$('model-select').value);if(!model?.vision){const vision=state.config.models.find(m=>m.configured&&m.vision);if(vision){$('model-select').value=vision.id;$('model-select').dispatchEvent(new Event('change'));toast(`图片已准备好，使用 ${vision.label} 识图讲解。`);}else toast('当前没有可用的识图模型。');}
 $('chat-input').focus();
}
function attachPhotos(files){return (async()=>{for(const file of files){try{await attachPhoto(file);}catch(error){toast(error.message);break;}}})();}
$('photo-input').onchange=action(async event=>{const files=[...event.target.files];event.target.value='';await attachPhotos(files);});
$('camera-input').onchange=action(async event=>{const file=event.target.files[0];event.target.value='';if(file)await attachPhoto(file);});
$('chat-input').addEventListener('paste',event=>{const files=[...(event.clipboardData?.files||[])].filter(f=>f.type.startsWith('image/'));if(files.length){event.preventDefault();attachPhotos(files).catch(e=>toast(e.message));}});
$('chat-form').addEventListener('dragover',event=>{event.preventDefault();$('chat-form').classList.add('dragging');});
$('chat-form').addEventListener('dragleave',()=>$('chat-form').classList.remove('dragging'));
$('chat-form').addEventListener('drop',event=>{event.preventDefault();$('chat-form').classList.remove('dragging');const files=[...(event.dataTransfer?.files||[])].filter(f=>f.type.startsWith('image/'));if(files.length)attachPhotos(files).catch(e=>toast(e.message));});
$('chat-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!matchMedia('(pointer:coarse)').matches){event.preventDefault();$('chat-form').requestSubmit();}});
let cameraStream=null;
function stopCamera(){cameraStream?.getTracks().forEach(track=>track.stop());cameraStream=null;$('camera-video').srcObject=null;}
$('camera-chat').onclick=action(async()=>{if(matchMedia('(pointer:coarse)').matches){$('camera-input').click();return;}if(!navigator.mediaDevices?.getUserMedia){$('camera-input').click();return;}try{cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});$('camera-video').srcObject=cameraStream;$('camera-dialog').showModal();}catch{toast('相机未能打开，请允许相机权限，或使用“上传图片”。');}});
$('camera-close').onclick=()=>{stopCamera();$('camera-dialog').close();};$('camera-dialog').addEventListener('close',stopCamera);
$('camera-capture').onclick=action(async()=>{const video=$('camera-video');if(!video.videoWidth)return toast('相机正在准备，请稍等。');const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));stopCamera();$('camera-dialog').close();await attachPhoto(new File([blob],'拍照.jpg',{type:'image/jpeg'}));});
function renderMemory(){const m=state.memory;if(!m)return;$('memory-stats').replaceChildren(statCard(m.topics.reduce((n,t)=>n+t.totalAttempts,0),'已记录作答'),statCard(m.strengths.length,'有证据的强项'),statCard(m.weaknesses.length,'待巩固知识点'));$('topic-memory').replaceChildren();for(const topic of m.topics){const card=node('article','memory-card');card.append(node('h3','',`${topic.subject} · ${topic.skill||topic.topic}`),node('span','badge '+(topic.status==='稳定强项'?'strong':topic.status==='需要巩固'?'weak':''),topic.status),node('p','',topic.totalAttempts?topic.explanation:'从一道练习开始，慢慢积累这个知识点的记录。'));if(topic.progress&&topic.totalAttempts)card.append(node('p','',topic.progress.note));if(topic.assistedAttempts)card.append(node('p','',`另有 ${topic.assistedAttempts} 次提示后或已看解答的练习。`));if(topic.recentAttempts.length){const details=node('details','evidence');details.append(node('summary','',`查看最近 ${topic.recentAttempts.length} 条依据`));const list=node('ul');topic.recentAttempts.forEach(a=>{const q=state.learning.questions.find(q=>q.id===a.questionId);const item=node('li','',`${new Date(a.at).toLocaleDateString('zh-CN')} · ${a.correct?'答对':'待调整'} · ${{none:'系统未提示',hint:'提示后作答',solution:'已看过解答',unknown:'提示情况未记录'}[a.support]} — ${q?.stem||a.questionId}`);list.append(item);});details.append(list);card.append(details);}$('topic-memory').append(card);}$('student-avatar').textContent=(m.profile.displayName||'同学').slice(0,1);if(document.activeElement.closest?.('#profile-form'))return;$('display-name').value=m.profile.displayName;$('preferences').value=m.profile.preferences;$('profile-notes').value=m.profile.notes.map(n=>n.text||n).join('\n');}
async function refreshMemory(){state.memory=await api('/api/memory');renderMemory();}
$('profile-form').onsubmit=action(async event=>{event.preventDefault();await api('/api/profile',{displayName:$('display-name').value,preferences:$('preferences').value,notes:$('profile-notes').value.split('\n').filter(Boolean)});await refreshMemory();toast('学习偏好已保存，下一次讲解会参考这份档案。');});
$('import-form').onsubmit=action(async event=>{event.preventDefault();await api('/api/questions',{stem:$('import-stem').value,topic:$('import-topic').value,answer:$('import-answer').value,source:$('import-source').value,solution:$('import-solution').value});event.target.reset();await refreshLearning();await refreshMemory();toast('题目已保存到你的学习档案。');});
function renderPapers(){const subject=$('subject-filter').value,year=$('year-filter').value,search=$('paper-search').value.trim();const filtered=state.papers.filter(p=>(!subject||p.subject===subject)&&(!year||p.year===year)&&(!search||p.title.includes(search)));const list=$('paper-list');list.replaceChildren();if(!filtered.length)list.append(node('div','empty','当前筛选没有试卷。'));for(const paper of filtered){const row=node('article','paper'),text=node('div');text.append(node('h3','',paper.title),node('p','',`${paper.year} · ${paper.pages||'页数待核对'} 页 · ${paper.status==='downloaded'?'已保存 PDF':paper.status==='print_only'?'来源网站仅提供打印':'等待下载'}`));const link=node('a','',paper.href?'打开 PDF':'查看来源');link.href=paper.href||paper.sourceUrl;link.target='_blank';link.rel='noopener';row.append(node('div','paper-icon',paper.subject.length>3?'道法':paper.subject),text,link);list.append(row);}}
async function refreshPapers(){const result=await api('/api/papers');state.papers=result.papers;$('nav-paper-count').textContent=String(result.counts.downloaded||0);$('paper-stats').replaceChildren(statCard(result.counts.downloaded||0,'本地整卷 PDF'),statCard(new Set(state.papers.filter(p=>p.status==='downloaded').map(p=>p.subject)).size,'已保存科目'),statCard(result.counts.print_only||0,'仅打印来源记录'));for(const [id,values]of [['subject-filter',[...new Set(state.papers.map(p=>p.subject))]],['year-filter',[...new Set(state.papers.map(p=>p.year))].sort().reverse()]]){const select=$(id),old=select.value;select.replaceChildren(new Option(id==='subject-filter'?'全部科目':'全部年份',''),...values.map(v=>new Option(v,v)));select.value=old;}renderPapers();}
['subject-filter','year-filter'].forEach(id=>$(id).onchange=renderPapers);$('paper-search').oninput=renderPapers;$('refresh-papers').onclick=action(refreshPapers);
$('export-data').onclick=action(async()=>{const data=await api('/api/export');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=node('a');a.href=url;a.download=`知序学习档案-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
async function init(){$('today-date').textContent=new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long',timeZone:'Asia/Shanghai'}).format(new Date());state.config=await api('/api/config');$('open-media').textContent='生成图解提示词';const select=$('model-select');select.replaceChildren(...state.config.models.map(m=>new Option(`${m.label}${m.vision?' · 识图':''}${m.configured?'':' · 未配置'}`,m.id)));const preferred=localStorage.getItem('zhixu-model')||state.config.defaultModel;select.value=state.config.models.find(m=>m.id===preferred&&m.configured)?.id||state.config.models.find(m=>m.configured)?.id||preferred;select.onchange=()=>{localStorage.setItem('zhixu-model',select.value);$('selected-model-label').textContent=state.config.models.find(m=>m.id===select.value)?.label||'选择模型';$('model-status').textContent=state.config.models.find(m=>m.id===select.value)?.configured?'可用于当前讲解':'这个模型还需要在家庭设置中配置';};select.onchange();await refreshLearning();await refreshMemory();const session=await api(`/api/sessions/${state.sessionId}`);state.chatQuestionId=session.questionId||null;$('messages').replaceChildren();if(session.messages.some(m=>m.role==='user'))session.messages.forEach((m,index)=>{const message=addMessage(m.role,m.content,m.imageUrls||m.imageUrl,m.agentName||DEFAULT_AGENT_NAME,m.imageError||'',m.imageJob||null);videoUI.attach(message,m,session.id,index);if(m.imageJob?.status==='pending')void watchImageJob(m.imageJob.id,session.id,message);});else showChatWelcome();localStorage.setItem('zhixu-session-'+state.user.id,state.sessionId);}
const family=setupFamily({api,action,node,toast});
const speech=createSpeechPlayer({toast});
const appearance=setupAppearance({api,toast,speech,onAgentName:name=>{
 document.querySelector('.agent-identity strong').textContent=name;document.querySelector('.agent-identity strong').title=name;
 document.querySelector('[data-page="tutor"] span').textContent=`问问${name}`;
 $('tutor').setAttribute('aria-label',`和${name}聊天`);
 if($('tutor').classList.contains('active'))$('current-page-label').textContent=`问问${name}`;
 $('student-attempt').placeholder=`先试一步，再告诉${name}你是怎么想的。`;
 if($('chat-welcome')){$('chat-welcome').remove();showChatWelcome(name);}
}});
const celebration=createCelebration({settings:()=>appearance.celebrationOptions(),isSpeaking:()=>speech.isActive()});
startAccount(async user=>{state.user=user;state.sessionId=localStorage.getItem('zhixu-session-'+user.id)||crypto.randomUUID();await appearance.refresh();await init();await refreshConversations();await family.refreshLinks();page('tutor');}).catch(error=>toast(error.message));

function showChatWelcome(name=appearance.agentName()){const el=addMessage('assistant',welcomeMessage(state.memory?.profile||{},name),null,name);el.id='chat-welcome';el.classList.add('greeting-message');}
function closeNavigation(){document.body.classList.remove('navigation-open');$('sidebar-scrim').hidden=true;$('nav-toggle').setAttribute('aria-expanded','false');}
$('nav-toggle').onclick=()=>{const open=!document.body.classList.contains('navigation-open');document.body.classList.toggle('navigation-open',open);$('sidebar-scrim').hidden=!open;$('nav-toggle').setAttribute('aria-expanded',String(open));};$('sidebar-scrim').onclick=closeNavigation;document.addEventListener('keydown',e=>{if(e.key==='Escape')closeNavigation();});
$('open-review').onclick=()=>{$('review-dialog').showModal();document.querySelector('.tutor-settings').open=false;};$('review-close').onclick=()=>$('review-dialog').close();
$('open-media').onclick=()=>{$('media-dialog').showModal();document.querySelector('.tutor-settings').open=false;};$('media-close').onclick=()=>$('media-dialog').close();
async function refreshConversations(){
 const result=await api('/api/sessions');$('conversation-list').replaceChildren();
 for(const session of result.sessions){
  const button=node('button','conversation-item'+(session.id===state.sessionId?' active':''),session.title);button.title=session.title;
  button.onclick=action(async()=>{
   if(state.sending)return toast('请等这一轮讲解完成。');
   const saved=await api('/api/sessions/'+session.id);state.sessionId=session.id;state.chatQuestionId=saved.questionId||null;state.images=[];$('photo-preview').replaceChildren();$('photo-preview').hidden=true;$('chat-input').value='';$('student-attempt').value='';$('messages').replaceChildren();
   saved.messages.forEach((m,index)=>{const message=addMessage(m.role,m.content,m.imageUrls||m.imageUrl,m.agentName||DEFAULT_AGENT_NAME,m.imageError||'',m.imageJob||null);videoUI.attach(message,m,saved.id,index);if(m.imageJob?.status==='pending')void watchImageJob(m.imageJob.id,saved.id,message);});
   localStorage.setItem('zhixu-session-'+state.user.id,state.sessionId);page('tutor');await refreshConversations();
  });
  $('conversation-list').append(button);
 }
 if(!result.sessions.length)$('conversation-list').append(node('p','empty-history','聊过的问题，会记在这里。'));
}
